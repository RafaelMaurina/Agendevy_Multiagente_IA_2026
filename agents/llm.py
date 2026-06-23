"""Wrappers de chamada ao Ollama: tool-calling genérico (`chat_com_tools`) e dois modos mais
simples de chat (`chat_json`, `chat_texto`) usados pelos 4 agentes do terminal.

Nenhuma das três funções é um agente - não têm papel nem prompt de sistema fixo, são só
primitivos de chat que cada agente (planejador, recuperador, executor, revisor) reusa com seu
próprio prompt de sistema e seu próprio subconjunto de tools/schema.

Nota sobre `chat_com_tools()`: implementa o mecanismo genérico de tool-calling (o modelo decide
chamar uma tool, a tool é executada de verdade, o resultado volta pro modelo, repete até
responder com texto final), mas os 4 agentes do terminal NÃO o usam - eles usam `chat_json`
(planejador) e `chat_texto` (revisor), mais previsíveis para um modelo local pequeno do que
deixar o próprio modelo decidir qual tool chamar (ver decisão de design em
`agentes/executor.py`). `chat_com_tools()` fica aqui validado (`test_llm_loop.py`) como o
primitivo genérico para quem precisar dele - ex: um cliente MCP próprio sobre o Ollama - mas
hoje nenhum outro módulo deste projeto o chama.

As tools de `chat_com_tools()` são passadas como funções Python "de verdade" (com type hints e
docstring) - o cliente `ollama` gera o schema JSON automaticamente a partir da assinatura e da
docstring de cada função, então o schema nunca pode ficar dessincronizado da implementação real.
"""
from __future__ import annotations

import json
from typing import Any, Callable

import ollama

from . import config

ToolFunc = Callable[..., Any]


class LimiteDeIteracoesExcedido(RuntimeError):
    """Levantado quando o modelo continua chamando tools além de `max_iteracoes` sem nunca
    responder com texto final - geralmente sinal de um loop (a tool sempre falha e o modelo
    insiste, ou o modelo não está interpretando corretamente o resultado da tool)."""


def _executar_tool_call(tool_call: Any, tools_disponiveis: dict[str, ToolFunc]) -> str:
    """Executa uma chamada de tool decidida pelo modelo e devolve o resultado serializado
    como string JSON (formato esperado pela mensagem de role="tool" que volta pro modelo)."""
    nome = tool_call.function.name
    argumentos = dict(tool_call.function.arguments or {})

    funcao = tools_disponiveis.get(nome)
    if funcao is None:
        resultado: Any = {"erro": True, "mensagem": f"Tool desconhecida: {nome}"}
    else:
        try:
            resultado = funcao(**argumentos)
        except TypeError as exc:
            # Argumentos errados vindos do modelo (acontece com modelos locais menores) - não
            # deixa o programa quebrar, devolve o erro pro próprio modelo tentar corrigir.
            resultado = {"erro": True, "mensagem": f"Argumentos inválidos para {nome}: {exc}"}
        except Exception as exc:  # nunca deixar uma tool derrubar o loop de chat
            resultado = {"erro": True, "mensagem": f"Falha ao executar {nome}: {exc}"}

    return json.dumps(resultado, ensure_ascii=False, default=str)


def chat_com_tools(
    mensagens: list[dict],
    tools: list[ToolFunc],
    max_iteracoes: int = 5,
    cliente: ollama.Client | None = None,
) -> dict:
    """Conversa com o modelo local, executando de fato qualquer tool que ele decidir chamar.

    `mensagens` segue o formato do cliente ollama: lista de {"role": ..., "content": ...}
    (normalmente começando com uma mensagem "system" definindo o papel do agente que está
    chamando esta função).
    `tools` é uma lista de funções Python - passe as próprias funções de
    `agents.tools.agendevy_tools`, não schemas escritos à mão.
    `cliente` permite injetar um `ollama.Client` (ou um substituto/mock) para testes; por
    padrão cria um cliente real apontando para `config.OLLAMA_HOST`.

    Retorna {"resposta": str, "historico": list[dict], "chamadas": list[dict]} - "chamadas"
    registra cada tool chamada com seus argumentos e resultado (útil para inspecionar o
    raciocínio de quem usar esta função; os 4 agentes do terminal não a chamam - ver nota no
    topo do módulo).
    """
    tools_disponiveis: dict[str, ToolFunc] = {t.__name__: t for t in tools}
    historico: list[dict] = list(mensagens)
    chamadas_registradas: list[dict] = []

    cliente = cliente or ollama.Client(host=config.OLLAMA_HOST)

    for _ in range(max_iteracoes):
        resposta = cliente.chat(
            model=config.OLLAMA_MODEL,
            messages=historico,
            tools=tools,
        )
        mensagem = resposta.message
        historico.append(mensagem.model_dump(exclude_none=True))

        if not mensagem.tool_calls:
            return {
                "resposta": mensagem.content or "",
                "historico": historico,
                "chamadas": chamadas_registradas,
            }

        for tool_call in mensagem.tool_calls:
            resultado_str = _executar_tool_call(tool_call, tools_disponiveis)
            chamadas_registradas.append(
                {
                    "tool": tool_call.function.name,
                    "argumentos": dict(tool_call.function.arguments or {}),
                    "resultado": resultado_str,
                }
            )
            historico.append(
                {
                    "role": "tool",
                    "tool_name": tool_call.function.name,
                    "content": resultado_str,
                }
            )

    raise LimiteDeIteracoesExcedido(
        f"O modelo continuou chamando tools após {max_iteracoes} iterações sem responder com "
        "texto final. Tools chamadas, em ordem: "
        + ", ".join(c["tool"] for c in chamadas_registradas)
    )


def chat_json(
    mensagens: list[dict],
    schema: dict,
    cliente: ollama.Client | None = None,
) -> dict:
    """Chamada de chat de uma única vez, forçando a resposta a seguir um JSON schema.

    Usa o parâmetro `format` do Ollama (decodificação restrita à gramática do schema, suportada
    desde as versões do Ollama com `llama.cpp` recente) - muito mais confiável do que só pedir
    "responda em JSON" no prompt, especialmente em modelos locais pequenos.

    Usado pelo agente planejador para extrair a intenção estruturada do pedido do usuário.
    Levanta `json.JSONDecodeError` se, ainda assim, a resposta não for um JSON válido (não
    deveria acontecer com o `format` aplicado, mas modelos locais às vezes surpreendem).
    """
    cliente = cliente or ollama.Client(host=config.OLLAMA_HOST)
    resposta = cliente.chat(
        model=config.OLLAMA_MODEL,
        messages=mensagens,
        format=schema,
    )
    conteudo = resposta.message.content or "{}"
    return json.loads(conteudo)


def chat_texto(
    mensagens: list[dict],
    cliente: ollama.Client | None = None,
) -> str:
    """Chamada de chat de uma única vez, sem tools e sem formato forçado - só texto livre.

    Usado pelo agente revisor para compor a resposta final em linguagem natural a partir do
    resumo estruturado montado pelos outros agentes.
    """
    cliente = cliente or ollama.Client(host=config.OLLAMA_HOST)
    resposta = cliente.chat(model=config.OLLAMA_MODEL, messages=mensagens)
    return resposta.message.content or ""
