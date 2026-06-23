"""Teste de orquestração do REPL (`agents.main.processar_pedido`).

`test_agentes.py` cobre os 3 cenários obrigatórios chamando os 4 agentes diretamente
(planejador -> recuperador -> executor -> revisor); a "cola" entre eles dentro de
`main.processar_pedido` - incluindo os parâmetros de injeção `cliente_planejador`/
`cliente_revisor` e o encadeamento do histórico de conversa entre turnos - não tinha nenhum
teste próprio até aqui. É isso que este arquivo cobre.

Diferente de `test_agentes.py`, este teste NÃO reconstrói o índice do RAG com embeddings falsos
(ver `_preparar_rag` lá) - usa os dados e o índice já existentes tal como estão, pra não
substituir um índice real (sentence-transformers) por um de teste que precisaria ser
reconstruído de novo depois. Por isso, em vez de nomes fixos de uma fixture, busca um paciente/
profissional/tipo de consulta reais via as tools - funciona contra qualquer banco que tenha pelo
menos 1 registro de cada.

Rodar a partir da raiz do repositório, com o backend do Agendevy rodando:
    python -m agents.test_main
"""
from __future__ import annotations

import json

import httpx
from ollama._types import ChatResponse, Message

from . import config, main
from .test_agentes import ClienteFalsoJSON, ClienteFalsoTexto
from .tools import agendevy_tools as tools

# Bem longe de qualquer consulta/bloqueio que já exista numa base real, pra nunca colidir.
_DATA_HORA_TESTE_1 = "2026-09-15T11:00:00-03:00"
_DATA_HORA_TESTE_2 = "2026-09-16T11:00:00-03:00"


def _primeiro_registro_real() -> tuple[dict, dict, dict]:
    """Busca um paciente, um profissional e um tipo de consulta reais pra montar os cenários
    abaixo - qualquer um cadastrado serve, não depende de uma fixture com nomes fixos."""
    pacientes = tools.listar_pacientes()
    profissionais = tools.listar_profissionais()
    tipos = tools.listar_tipos_consulta()
    assert pacientes, "Backend sem nenhum paciente cadastrado - não há como testar processar_pedido()."
    assert profissionais, "Backend sem nenhum profissional cadastrado - não há como testar processar_pedido()."
    assert tipos, "Backend sem nenhum tipo de atendimento cadastrado - não há como testar processar_pedido()."
    return pacientes[0], profissionais[0], tipos[0]


def teste_processar_pedido_sem_conflito() -> None:
    print("\n" + "=" * 70)
    print("TESTE 1 - processar_pedido() de ponta a ponta, sem conflito")
    print("=" * 70)

    paciente, profissional, tipo = _primeiro_registro_real()
    payload = {
        "intencao": "agendar_consulta",
        "paciente_nome": paciente["nome"],
        "profissional_nome": profissional["nome"],
        "tipo_consulta_nome": tipo["nome"],
        "data_hora_iso": _DATA_HORA_TESTE_1,
        "pergunta_livre": None,
    }
    resposta = main.processar_pedido(
        f"marca um(a) {tipo['nome']} pra {paciente['nome']} com {profissional['nome']} em 15/09/2026 às 11h",
        cliente_planejador=ClienteFalsoJSON(payload),
        cliente_revisor=ClienteFalsoTexto(),
    )
    print("resposta:", resposta)
    assert isinstance(resposta, str) and resposta, "processar_pedido() deveria devolver texto não vazio."

    criadas = [
        c for c in tools.listar_consultas(paciente_id=paciente["id"])
        if c["data_hora"].startswith("2026-09-15")
    ]
    try:
        assert criadas, "Esperava encontrar, via API, a consulta criada por processar_pedido()."
        print("\nTeste 1 OK: processar_pedido() criou a consulta de verdade e devolveu uma resposta.")
    finally:
        # Mesma limpeza de test_agentes.py: sem isso, rodar o teste de novo colidiria de horário
        # com a consulta da execução anterior.
        for c in criadas:
            httpx.delete(f"{config.AGENDEVY_API_URL}/consultas/{c['id']}", timeout=config.HTTP_TIMEOUT)


def teste_pedido_com_paciente_inexistente_nao_quebra_o_repl() -> None:
    print("\n" + "=" * 70)
    print("TESTE 2 - paciente inexistente devolve erro como texto, sem lançar exceção")
    print("=" * 70)

    payload = {
        "intencao": "agendar_consulta",
        "paciente_nome": "Paciente Que Não Existe De Verdade",
        "profissional_nome": None,
        "tipo_consulta_nome": None,
        "data_hora_iso": _DATA_HORA_TESTE_2,
        "pergunta_livre": None,
    }
    resposta = main.processar_pedido(
        "marca uma consulta pra Paciente Que Não Existe De Verdade",
        cliente_planejador=ClienteFalsoJSON(payload),
        cliente_revisor=ClienteFalsoTexto(),
    )
    print("resposta:", resposta)
    assert "não encontrei" in resposta.lower(), f"Esperava mensagem de paciente não encontrado, veio: {resposta}"
    print("\nTeste 2 OK: erro de resolução devolvido como texto, sem quebrar o REPL.")


class _ClienteCapturaMensagens:
    """Substituto do cliente do planejador que grava as mensagens recebidas (pra inspecionar se
    o histórico foi de fato incluído) e devolve um payload fixo, como ClienteFalsoJSON."""

    def __init__(self, payload: dict):
        self._payload = payload
        self.ultimas_mensagens: list[dict] = []

    def chat(self, **kwargs):
        self.ultimas_mensagens = list(kwargs.get("messages", []))
        return ChatResponse(message=Message(role="assistant", content=json.dumps(self._payload)))


def teste_historico_e_repassado_ao_planejador() -> None:
    print("\n" + "=" * 70)
    print("TESTE 3 - histórico de conversa chega até o cliente do planejador")
    print("=" * 70)

    payload = {
        "intencao": "outro",
        "paciente_nome": None,
        "profissional_nome": None,
        "tipo_consulta_nome": None,
        "data_hora_iso": None,
        "pergunta_livre": None,
    }
    cliente = _ClienteCapturaMensagens(payload)
    historico = [
        {"role": "user", "content": "o Valdivino tem alguma alergia?"},
        {
            "role": "assistant",
            "content": 'Encontrei mais de um paciente parecido com "Valdivino": Valdivino, Valdivino Jr. Qual deles?',
        },
    ]
    main.processar_pedido(
        "o primeiro mesmo",
        historico=historico,
        cliente_planejador=cliente,
        cliente_revisor=ClienteFalsoTexto(),
    )

    conteudos_enviados = [m.get("content") for m in cliente.ultimas_mensagens]
    assert historico[0]["content"] in conteudos_enviados, (
        "Esperava que a primeira mensagem do histórico fosse repassada ao cliente do planejador."
    )
    assert historico[1]["content"] in conteudos_enviados, (
        "Esperava que a segunda mensagem do histórico fosse repassada ao cliente do planejador."
    )
    assert conteudos_enviados[-1] == "o primeiro mesmo", (
        "A última mensagem enviada deveria ser o pedido atual, depois do histórico."
    )
    print("\nTeste 3 OK: histórico de turnos anteriores chega até o cliente do planejador, na ordem certa.")


def main_testes() -> None:
    teste_processar_pedido_sem_conflito()
    teste_pedido_com_paciente_inexistente_nao_quebra_o_repl()
    teste_historico_e_repassado_ao_planejador()
    print("\n" + "=" * 70)
    print("Todos os testes de orquestração do main.py passaram.")
    print("=" * 70)


if __name__ == "__main__":
    main_testes()
