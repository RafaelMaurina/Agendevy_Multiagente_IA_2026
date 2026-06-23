"""Testa a melhoria de relevância do recuperador: numa pergunta puramente sobre o paciente
(sem tipo de consulta nem intenção de agendar), ele NÃO deve despejar documentos de
procedimento ("RPG", "Avaliação Postural" etc.) na resposta - esse era o comportamento ruim
observado nos logs com o modelo real.

Usa a mesma embedding leve de teste das outras suítes (ver test_rag.py). Rodar da raiz, com o
backend de pé e o índice já construído:
    python -m agents.test_recuperador
"""
from __future__ import annotations

import hashlib
import re
import shutil

import numpy as np

from .agentes import recuperador
from .agentes.planejador import ResultadoPlanejador
from .rag import build_index, embeddings, vector_store as vs

_DIM = 256


def _tok(t):
    return re.findall(r"[a-zà-úA-ZÀ-Ú0-9]+", t.lower())


def _emb_fake(textos):
    out = []
    for t in textos:
        v = np.zeros(_DIM)
        for x in _tok(t):
            v[int(hashlib.md5(x.encode()).hexdigest(), 16) % _DIM] += 1.0
        n = np.linalg.norm(v)
        out.append((v / n if n > 0 else v).tolist())
    return out


def main():
    embeddings.gerar_embeddings = _emb_fake
    if vs.DATA_DIR.exists():
        shutil.rmtree(vs.DATA_DIR)
    vs._cliente = None
    build_index.main()

    pacientes = {p["nome"]: p["id"] for p in build_index.tools.listar_pacientes()}
    joao_id = pacientes.get("João Pedro Alves")
    assert joao_id, "Este teste pressupõe o paciente 'João Pedro Alves' cadastrado (alergia a dipirona)."

    # Pergunta PURAMENTE sobre o paciente - sem tipo de consulta, sem intenção de agendar.
    plano = ResultadoPlanejador(
        intencao="consultar_paciente",
        paciente_id=joao_id,
        pergunta_livre="o paciente tem alguma alergia a medicamentos?",
    )
    contexto = recuperador.recuperar_contexto(plano)

    print("trechos do paciente:", len(contexto.trechos_paciente))
    for t in contexto.trechos_paciente:
        print(f"   score={t['score']:.3f}  {t['texto'][:70]}")
    print("trechos de conhecimento clínico:", len(contexto.trechos_conhecimento))
    for t in contexto.trechos_conhecimento:
        print(f"   score={t['score']:.3f}  {t['texto'][:70]}")

    # O ponto da melhoria: numa consulta sobre o paciente, sem procedimento envolvido, NÃO
    # devem vir documentos de tipo de consulta poluindo a resposta.
    assert contexto.trechos_conhecimento == [], (
        "Consulta sobre paciente (sem tipo/sem agendar) não deveria trazer documentos de "
        f"procedimento, mas trouxe: {[t['metadata'] for t in contexto.trechos_conhecimento]}"
    )
    # E a anamnese relevante (alergia) deve continuar sendo recuperada.
    assert any("dipirona" in t["texto"].lower() for t in contexto.trechos_paciente), (
        "A anamnese sobre alergia a dipirona deveria ter sido recuperada."
    )

    print("\nRelevância OK: pergunta sobre paciente traz só a anamnese certa, sem lixo de procedimento.")

    # --- Caso 2: pergunta genérica deve trazer TODA a anamnese, não só o trecho mais parecido
    # com uma palavra-chave. Regressão do bug em que "o que preciso saber antes de atender X?"
    # trazia só a alergia e deixava de fora a medicação contínua.
    plano_generico = ResultadoPlanejador(
        intencao="consultar_paciente",
        paciente_id=joao_id,
        pergunta_livre="o que eu preciso saber antes de atender esse paciente?",
    )
    ctx2 = recuperador.recuperar_contexto(plano_generico)
    # João tem só 1 resposta de anamnese neste seed; o que importa é que a recuperação genérica
    # use listar_contexto_paciente (score fixo 1.0) e não filtre por similaridade.
    assert ctx2.trechos_paciente, "Pergunta genérica deveria trazer a anamnese do paciente."
    assert all(t["score"] == 1.0 for t in ctx2.trechos_paciente), (
        "Pergunta genérica deveria usar listagem completa (score 1.0), não busca semântica filtrada."
    )
    print("Pergunta genérica traz toda a anamnese (sem filtrar por palavra-chave).")


if __name__ == "__main__":
    main()
