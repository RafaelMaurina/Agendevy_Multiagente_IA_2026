"""Teste de ponta a ponta dos 4 agentes orquestrados (planejador -> recuperador -> executor ->
revisor), contra a API real do Agendevy e o RAG real.

Os agentes planejador (extração de intenção) e revisor (composição da resposta final) dependem
do LLM. Para manter este teste determinístico e independente de o Ollama estar rodando, ele
injeta clientes Ollama falsos com respostas roteirizadas para cada cenário (`cliente=` é um
parâmetro de injeção de dependência em `planejador.interpretar_pedido()` e `revisor.revisar()`,
criado exatamente para isso).

O que ISSO valida: que a orquestração entre os 4 agentes, a resolução de nomes para ids reais,
a execução real contra a API (incluindo o tratamento de conflito 409), o cálculo de horários
alternativos e a checagem de saldo financeiro funcionam corretamente - tudo isso é determinístico
e não depende da qualidade do modelo.
O que ISSO NÃO valida: se um modelo local de verdade (llama3.1:8b) consegue extrair a intenção
estruturada corretamente a partir de texto livre variado, ou compor uma resposta final boa.
Isso só se valida rodando de verdade com o Ollama (`python -m agents.main --verbose`) - ver
agents/README.md.

Rodar a partir da raiz do repositório, com o backend do Agendevy rodando:
    python -m agents.test_agentes
"""
from __future__ import annotations

import json
import shutil

import httpx
from ollama._types import ChatResponse, Message

from . import config
from .agentes import executor, planejador, recuperador, revisor
from .rag import build_index, embeddings, vector_store as vs

# Mesmo substituto leve de embeddings usado em test_rag.py - ver docstring lá para o porquê.
import hashlib
import re

import numpy as np

_DIM = 256


def _tokenizar(texto: str) -> list[str]:
    return re.findall(r"[a-zà-úA-ZÀ-Ú0-9]+", texto.lower())


def _hash_index(token: str) -> int:
    return int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16) % _DIM


def _embeddings_fake_para_teste(textos: list[str]) -> list[list[float]]:
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


class ClienteFalsoJSON:
    """Simula o planejador: sempre devolve o mesmo payload de intenção estruturada."""

    def __init__(self, payload: dict):
        self._payload = payload

    def chat(self, **kwargs):
        return ChatResponse(message=Message(role="assistant", content=json.dumps(self._payload)))


class ClienteFalsoTexto:
    """Simula o revisor: devolve um texto fixo qualquer - a prosa em si não é o que este
    teste valida (isso exige o modelo real); o que importa é o resumo estruturado por trás,
    que é checado separadamente em `resultado.resumo_para_debug` e nos campos estruturados."""

    def chat(self, **kwargs):
        return ChatResponse(message=Message(role="assistant", content="[resposta simulada pelo teste]"))


def _preparar_rag() -> dict[str, int]:
    embeddings.gerar_embeddings = _embeddings_fake_para_teste
    if vs.DATA_DIR.exists():
        shutil.rmtree(vs.DATA_DIR)
    vs._cliente = None
    build_index.main()
    return {p["nome"]: p["id"] for p in build_index.tools.listar_pacientes()}


def cenario_1_agendamento_sem_conflito(pacientes_por_nome: dict[str, int]) -> None:
    print("\n" + "=" * 70)
    print("CENÁRIO 1 - agendamento simples, sem conflito")
    print("=" * 70)

    payload = {
        "intencao": "agendar_consulta",
        "paciente_nome": "Marga Almeida",
        "profissional_nome": "Evllyn T",
        "tipo_consulta_nome": "Fisioterapia",
        "data_hora_iso": "2026-08-20T10:00:00-03:00",
        "pergunta_livre": None,
    }
    plano = planejador.interpretar_pedido(
        "marca uma fisioterapia pra Marga Almeida com a Evllyn T dia 20/08/2026 às 10h",
        cliente=ClienteFalsoJSON(payload),
    )
    print("plano:", plano)
    assert plano.erro is None, f"Não esperava erro de resolução: {plano.erro}"
    assert plano.paciente_id == pacientes_por_nome["Marga Almeida"]
    assert plano.tipo_consulta_nome == "Fisioterapia - Sessão"

    contexto = recuperador.recuperar_contexto(plano)
    execucao = executor.executar(plano)
    print("execução:", execucao)

    consulta_criada_id = execucao.dados.get("id") if isinstance(execucao.dados, dict) else None
    try:
        assert execucao.sucesso, f"Esperava sucesso na criação da consulta: {execucao.mensagem_erro}"
        assert execucao.dados["status"] == "aberta"

        resultado = revisor.revisar(plano, execucao, contexto, cliente=ClienteFalsoTexto())
        print("resumo interno do revisor:\n", resultado.resumo_para_debug["resumo_textual"])
        assert resultado.sugestoes_horario == []
        # Marga não tem nenhum crédito cadastrado e o tipo de consulta é pago -> aviso esperado.
        assert resultado.aviso_financeiro is not None, "Esperava aviso de pendência financeira para a Marga."
        print("\nCenário 1 OK: consulta criada de verdade na API, sem conflito, com aviso financeiro correto.")
    finally:
        # Limpeza: este teste cria uma consulta real na API. Sem isso, rodar o teste de novo
        # colidiria com a consulta da execução anterior e o cenário "sem conflito" falharia
        # por conflito. `agendevy_tools.py` não tem uma tool "excluir_consulta" - não é
        # necessário para os agentes, então a limpeza aqui é feita com uma chamada HTTP direta.
        if consulta_criada_id is not None:
            httpx.delete(f"{config.AGENDEVY_API_URL}/consultas/{consulta_criada_id}", timeout=config.HTTP_TIMEOUT)


def cenario_2_agendamento_com_conflito() -> None:
    print("\n" + "=" * 70)
    print("CENÁRIO 2 - agendamento com conflito de horário (409)")
    print("=" * 70)

    # Mesmo profissional + mesmo horário de uma consulta já existente (dado de setup assumido
    # no banco): paciente Valdivino já tem consulta com profissional Evllyn T em
    # 2026-07-10T14:00 (UTC-3).
    payload = {
        "intencao": "agendar_consulta",
        "paciente_nome": "Daniels Djalma Neto Jr",
        "profissional_nome": "Evllyn T",
        "tipo_consulta_nome": "Fisioterapia",
        "data_hora_iso": "2026-07-10T14:00:00-03:00",
        "pergunta_livre": None,
    }
    plano = planejador.interpretar_pedido(
        "agenda uma fisioterapia pro Daniels Djalma Neto Jr com a Evllyn T no dia 10/07/2026 às 14h",
        cliente=ClienteFalsoJSON(payload),
    )
    assert plano.erro is None, f"Não esperava erro de resolução: {plano.erro}"

    contexto = recuperador.recuperar_contexto(plano)
    execucao = executor.executar(plano)
    print("execução:", execucao)
    assert not execucao.sucesso
    assert execucao.tipo_erro == "conflito_409", f"Esperava conflito 409, veio: {execucao.tipo_erro} / {execucao.mensagem_erro}"

    resultado = revisor.revisar(plano, execucao, contexto, cliente=ClienteFalsoTexto())
    print("resumo interno do revisor:\n", resultado.resumo_para_debug["resumo_textual"])
    assert len(resultado.sugestoes_horario) > 0, "Esperava ao menos 1 horário alternativo sugerido."
    for sugestao in resultado.sugestoes_horario:
        assert "2026-07-10" in sugestao, f"Sugestão fora do dia pedido: {sugestao}"
        assert sugestao != "2026-07-10T14:00:00-03:00", "Não pode sugerir o próprio horário em conflito."
    print(f"\nCenário 2 OK: conflito 409 detectado (não travou o programa), {len(resultado.sugestoes_horario)} horário(s) alternativo(s) sugerido(s): {resultado.sugestoes_horario}")


def cenario_3_consulta_sobre_paciente(pacientes_por_nome: dict[str, int]) -> None:
    print("\n" + "=" * 70)
    print("CENÁRIO 3 - pergunta sobre paciente, sem agendamento")
    print("=" * 70)

    payload = {
        "intencao": "consultar_paciente",
        "paciente_nome": "Valdivino",
        "profissional_nome": None,
        "tipo_consulta_nome": None,
        "data_hora_iso": None,
        # Nota: a query precisa compartilhar palavras literais com o texto indexado porque a
        # embedding de teste (hashing de palavras, ver topo do arquivo) não captura sinônimo
        # nem paráfrase - só sobreposição literal. Com sentence-transformers de verdade, uma
        # pergunta mais genérica como "o que preciso saber antes de atender esse paciente?"
        # funcionaria igual (foi a frase usada originalmente aqui, mas marcava 0 resultado
        # com a embedding de teste - não é um bug do recuperador, é a limitação conhecida do
        # substituto leve, documentada em agents/README.md).
        "pergunta_livre": "o paciente tem alguma alergia a medicamentos?",
    }
    plano = planejador.interpretar_pedido(
        "o Valdivino tem alguma alergia a medicamentos que eu deveria saber antes de atendê-lo?",
        cliente=ClienteFalsoJSON(payload),
    )
    assert plano.erro is None
    assert plano.intencao == "consultar_paciente"
    assert plano.paciente_id == pacientes_por_nome["Valdivino"]

    contexto = recuperador.recuperar_contexto(plano)
    print(f"trechos do paciente recuperados: {len(contexto.trechos_paciente)}")
    for t in contexto.trechos_paciente:
        print(f"  score={t['score']:.3f}  {t['texto']}")
    assert contexto.trechos_paciente, "Esperava recuperar a anamnese sobre alergia a dipirona do João."
    assert any("dipirona" in t["texto"].lower() for t in contexto.trechos_paciente)

    execucao = executor.executar(plano)
    assert execucao.sucesso and execucao.dados is None, "consultar_paciente não deveria chamar nenhuma tool de agendamento."

    resultado = revisor.revisar(plano, execucao, contexto, cliente=ClienteFalsoTexto())
    print("resumo interno do revisor:\n", resultado.resumo_para_debug["resumo_textual"])
    assert "dipirona" in resultado.resumo_para_debug["resumo_textual"].lower()
    print("\nCenário 3 OK: nenhuma tool de agendamento chamada, resposta baseada só em RAG sobre o paciente certo.")


def main() -> None:
    pacientes_por_nome = _preparar_rag()
    cenario_1_agendamento_sem_conflito(pacientes_por_nome)
    cenario_2_agendamento_com_conflito()
    cenario_3_consulta_sobre_paciente(pacientes_por_nome)
    print("\n" + "=" * 70)
    print("Todos os 3 cenários obrigatórios passaram de ponta a ponta.")
    print("=" * 70)


if __name__ == "__main__":
    main()
