"""Teste de ponta a ponta do RAG: constrói o índice a partir de dados reais da API e roda
queries de exemplo nas duas coleções (conhecimento clínico e contexto por paciente).

Sobre embeddings neste ambiente de teste: o sandbox onde esta implementação foi gerada não
tem espaço em disco para o `torch`/`sentence-transformers` completos (puxam suporte a GPU,
3GB+). Para validar o *pipeline* (indexação, upsert idempotente, filtro por paciente_id, busca
por similaridade) sem depender disso, este script substitui `embeddings.gerar_embeddings` por
uma função leve baseada em "hashing trick" (bag-of-words com hash, sem vocabulário pré-fixo,
só numpy) - captura sobreposição de palavras reais entre query e documento, o suficiente para
validar que o documento certo é recuperado. A qualidade semântica de verdade (sinônimos,
paráfrase) só vem com o `sentence-transformers` real, que é o que está implementado em
`embeddings.py` para uso em produção. Ver `agents/README.md` para como validar com o modelo
real.

Rodar a partir da raiz do repositório, com o backend do Agendevy rodando:
    python -m agents.test_rag
"""
from __future__ import annotations

import hashlib
import re
import shutil

import numpy as np

from .rag import build_index, embeddings, vector_store as vs

_DIM = 256


def _tokenizar(texto: str) -> list[str]:
    return re.findall(r"[a-zà-úA-ZÀ-Ú0-9]+", texto.lower())


def _hash_index(token: str) -> int:
    return int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16) % _DIM


def _embeddings_fake_para_teste(textos: list[str]) -> list[list[float]]:
    """Substituto leve de `embeddings.gerar_embeddings`, só para este teste - ver docstring
    do módulo. NUNCA usado em produção; `embeddings.py` continua usando sentence-transformers."""
    vetores = []
    for texto in textos:
        v = np.zeros(_DIM, dtype=float)
        for tok in _tokenizar(texto):
            v[_hash_index(tok)] += 1.0
        norma = np.linalg.norm(v)
        if norma > 0:
            v = v / norma
        vetores.append(v.tolist())
    return vetores


def _print_resultados(titulo: str, resultados: list[dict]) -> None:
    print(f"\n--- {titulo} ---")
    if not resultados:
        print("(nenhum resultado)")
        return
    for r in resultados:
        trecho = r["texto"][:90].replace("\n", " ")
        print(f"  score={r['score']:.3f}  metadata={r['metadata']}  texto='{trecho}...'")


def main() -> None:
    # Monkeypatch: troca a geração de embeddings real por nossa versão leve, só para este
    # processo de teste (o atributo no módulo `embeddings` é o que `vector_store` consulta).
    embeddings.gerar_embeddings = _embeddings_fake_para_teste

    # Índice limpo, para o teste de idempotência abaixo ser conclusivo.
    if vs.DATA_DIR.exists():
        shutil.rmtree(vs.DATA_DIR)
    global vs_cliente_resetado
    vs._cliente = None

    print("=== 1ª execução do build_index (índice vazio) ===")
    build_index.main()

    colecao_conhecimento = vs._get_colecao(vs.COLECAO_CONHECIMENTO)
    colecao_pacientes = vs._get_colecao(vs.COLECAO_PACIENTES)
    total_conhecimento_1 = colecao_conhecimento.count()
    total_pacientes_1 = colecao_pacientes.count()
    assert total_conhecimento_1 > 0, "Esperava pelo menos 1 documento em conhecimento_clinico."
    assert total_pacientes_1 > 0, "Esperava pelo menos 1 documento em contexto_pacientes."

    print("\n=== 2ª execução do build_index (mesmos dados - checando idempotência) ===")
    build_index.main()
    total_conhecimento_2 = colecao_conhecimento.count()
    total_pacientes_2 = colecao_pacientes.count()
    assert total_conhecimento_2 == total_conhecimento_1, (
        f"Rodar build_index de novo duplicou documentos em conhecimento_clinico: "
        f"{total_conhecimento_1} -> {total_conhecimento_2}"
    )
    assert total_pacientes_2 == total_pacientes_1, (
        f"Rodar build_index de novo duplicou documentos em contexto_pacientes: "
        f"{total_pacientes_1} -> {total_pacientes_2}"
    )
    print(
        f"OK: contagens estáveis entre execuções "
        f"(conhecimento_clinico={total_conhecimento_2}, contexto_pacientes={total_pacientes_2})."
    )

    print("\n=== Queries de exemplo - conhecimento_clinico ===")
    resultados = vs.buscar_conhecimento_clinico("dor lombar crônica, qual tratamento é indicado?", top_k=5)
    _print_resultados("query: 'dor lombar crônica, qual tratamento é indicado?'", resultados)
    nomes_tipo = [r["metadata"].get("tipo_consulta_nome", "") for r in resultados]
    assert any("RPG" in n or "Fisioterapia" in n for n in nomes_tipo), (
        f"Esperava RPG ou Fisioterapia entre os resultados, veio: {nomes_tipo}"
    )

    resultados = vs.buscar_conhecimento_clinico("posso fazer essa terapia tomando anticoagulante?", top_k=5)
    _print_resultados("query: 'posso fazer essa terapia tomando anticoagulante?'", resultados)
    # Nota: com a embedding leve de teste (hashing de palavras, sem semântica), o ranqueamento
    # entre documentos próximos pode oscilar - então verificamos que Acupuntura está ENTRE os
    # resultados (é o único doc que menciona "anticoagulante"), não que seja necessariamente o
    # primeiro. Com o sentence-transformers real, ele tende a ficar em primeiro de fato.
    tipos_retornados = [r["metadata"].get("tipo_consulta_nome", "") for r in resultados]
    assert "Acupuntura" in tipos_retornados, (
        f"Esperava Acupuntura entre os resultados (é o único doc que menciona anticoagulante), "
        f"veio: {tipos_retornados}"
    )

    print("\n=== Queries de exemplo - contexto_pacientes ===")
    pacientes = {p["nome"]: p["id"] for p in build_index.tools.listar_pacientes()}

    joao_id = pacientes.get("João Pedro Alves")
    if joao_id:
        resultados = vs.buscar_contexto_paciente(joao_id, "o paciente tem alguma alergia a medicamentos?")
        _print_resultados(f"paciente_id={joao_id} (João) - query sobre alergias", resultados)
        assert resultados, "Esperava encontrar a resposta de anamnese sobre alergia a dipirona."
        assert "dipirona" in resultados[0]["texto"].lower()

    sergio_id = pacientes.get("Sérgio Mendes")
    if sergio_id:
        resultados = vs.buscar_contexto_paciente(sergio_id, "o paciente usa algum medicamento contínuo?")
        _print_resultados(f"paciente_id={sergio_id} (Sérgio) - query sobre medicação contínua", resultados)
        assert resultados, "Esperava encontrar a observação sobre uso de anticoagulante."
        assert "anticoagulante" in resultados[0]["texto"].lower()

    renata_id = pacientes.get("Renata Lima")
    if renata_id:
        resultados = vs.buscar_contexto_paciente(renata_id, "o que preciso saber antes de atender essa paciente?")
        _print_resultados(f"paciente_id={renata_id} (Renata, sem anamnese/observações) - deve vir vazio", resultados)
        assert resultados == [], "Paciente sem anamnese/observações deveria retornar lista vazia, não erro."

    print("\nTodos os asserts passaram - pipeline de RAG funcionando contra dados reais.")


if __name__ == "__main__":
    main()
