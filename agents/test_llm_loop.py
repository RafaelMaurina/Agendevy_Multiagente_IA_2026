"""Teste do mecanismo de tool-calling de `agents.llm`, sem depender de um servidor Ollama real.

Este sandbox de desenvolvimento não tem acesso de rede para instalar/rodar o Ollama de
verdade - então este teste substitui `ollama.Client` por um dublê que devolve respostas
pré-roteirizadas, simulando exatamente a forma como o SDK real estrutura uma chamada de tool
(`ollama._types.ChatResponse` / `Message` de verdade, não dicts inventados). Isso valida o
*mecanismo* do loop (executar a tool, devolver o resultado, repetir até texto final) - não
valida a qualidade de raciocínio de um modelo real, que só pode ser testada com o Ollama
rodando de fato (ver `agents/README.md`).

Rodar a partir da raiz do repositório:
    python -m agents.test_llm_loop
"""
from __future__ import annotations

from ollama._types import ChatResponse, Message

from . import llm


def soma(a: int, b: int) -> int:
    """Soma dois números inteiros."""
    return a + b


class ClienteFalso:
    """Dublê de ollama.Client: devolve uma sequência fixa de respostas, uma por chamada."""

    def __init__(self, respostas: list[ChatResponse]):
        self._respostas = list(respostas)
        self.chamadas = 0

    def chat(self, **kwargs):
        resposta = self._respostas[self.chamadas]
        self.chamadas += 1
        return resposta


def _tool_call(nome: str, **argumentos) -> Message.ToolCall:
    return Message.ToolCall(function=Message.ToolCall.Function(name=nome, arguments=argumentos))


def test_loop_executa_tool_e_para_no_texto_final():
    respostas = [
        ChatResponse(
            message=Message(role="assistant", content="", tool_calls=[_tool_call("soma", a=2, b=3)]),
        ),
        ChatResponse(
            message=Message(role="assistant", content="A soma de 2 e 3 é 5."),
        ),
    ]
    cliente_falso = ClienteFalso(respostas)

    resultado = llm.chat_com_tools(
        mensagens=[{"role": "user", "content": "quanto é 2 + 3?"}],
        tools=[soma],
        cliente=cliente_falso,
    )

    assert resultado["resposta"] == "A soma de 2 e 3 é 5."
    assert cliente_falso.chamadas == 2, "Esperava exatamente 2 chamadas ao modelo (1 tool call + 1 final)."
    assert len(resultado["chamadas"]) == 1
    assert resultado["chamadas"][0]["tool"] == "soma"
    assert resultado["chamadas"][0]["argumentos"] == {"a": 2, "b": 3}
    assert "5" in resultado["chamadas"][0]["resultado"]
    print("OK: loop executa a tool de verdade e para ao receber texto final.")


def test_loop_sem_tool_call_retorna_direto():
    respostas = [ChatResponse(message=Message(role="assistant", content="Oi! Como posso ajudar?"))]
    cliente_falso = ClienteFalso(respostas)

    resultado = llm.chat_com_tools(
        mensagens=[{"role": "user", "content": "oi"}],
        tools=[soma],
        cliente=cliente_falso,
    )

    assert resultado["resposta"] == "Oi! Como posso ajudar?"
    assert resultado["chamadas"] == []
    print("OK: sem tool call, o loop retorna na primeira resposta.")


def test_loop_estoura_max_iteracoes():
    # O modelo insiste em chamar a mesma tool pra sempre - simula um modelo "travado".
    respostas = [
        ChatResponse(message=Message(role="assistant", content="", tool_calls=[_tool_call("soma", a=1, b=1)]))
        for _ in range(5)
    ]
    cliente_falso = ClienteFalso(respostas)

    try:
        llm.chat_com_tools(
            mensagens=[{"role": "user", "content": "..."}],
            tools=[soma],
            max_iteracoes=3,
            cliente=cliente_falso,
        )
    except llm.LimiteDeIteracoesExcedido:
        print("OK: loop não roda pra sempre - estoura LimiteDeIteracoesExcedido como esperado.")
    else:
        raise AssertionError("Esperava LimiteDeIteracoesExcedido, mas o loop terminou normalmente.")


def test_tool_com_argumento_invalido_nao_quebra_o_loop():
    respostas = [
        ChatResponse(
            # "a" errado de propósito (a tool soma() não tem parâmetro "x")
            message=Message(role="assistant", content="", tool_calls=[_tool_call("soma", x=1)]),
        ),
        ChatResponse(message=Message(role="assistant", content="Desculpe, não consegui calcular.")),
    ]
    cliente_falso = ClienteFalso(respostas)

    resultado = llm.chat_com_tools(
        mensagens=[{"role": "user", "content": "quanto é 2 + 3?"}],
        tools=[soma],
        cliente=cliente_falso,
    )

    assert "erro" in resultado["chamadas"][0]["resultado"]
    assert resultado["resposta"] == "Desculpe, não consegui calcular."
    print("OK: argumento inválido vindo do modelo é tratado como erro, não derruba o programa.")


if __name__ == "__main__":
    test_loop_executa_tool_e_para_no_texto_final()
    test_loop_sem_tool_call_retorna_direto()
    test_loop_estoura_max_iteracoes()
    test_tool_com_argumento_invalido_nao_quebra_o_loop()
    print("\nTodos os testes do loop de tool-calling passaram.")
