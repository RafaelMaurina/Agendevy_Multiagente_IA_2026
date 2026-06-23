"""Agente executor: chama as tools certas com base na intenção já resolvida pelo planejador.

Decisão de design (documentada também no agents/README.md): o executor chama as funções de
`agendevy_tools.py` DIRETAMENTE, em vez de passar por outra rodada de `llm.chat_com_tools` (ou
pelo `mcp_server/server.py` - nenhum dos dois faz parte deste caminho de execução, ver nota no
README). Na hora em que o executor entra em ação, o planejador já
resolveu a intenção e todos os ids envolvidos de forma determinística - não há mais ambiguidade
para um LLM decidir. Adicionar uma segunda chamada ao modelo aqui só pra "decidir" uma chamada
de tool que já está implícita no resultado do planejador seria mais lento e introduziria uma
chance extra (e desnecessária) de um modelo local pequeno errar um argumento.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..tools import agendevy_tools as tools
from .planejador import ResultadoPlanejador


@dataclass
class ResultadoExecucao:
    sucesso: bool
    tipo_erro: str | None = None  # "conflito_409" | "erro" | None
    dados: Any = None
    mensagem_erro: str | None = None


def _executar_agendamento(plano: ResultadoPlanejador) -> ResultadoExecucao:
    faltando = []
    if not plano.paciente_id:
        faltando.append("paciente")
    if not plano.profissional_id:
        faltando.append("profissional")
    if not plano.data_hora_iso:
        faltando.append("data/hora")
    if faltando:
        return ResultadoExecucao(
            sucesso=False,
            tipo_erro="erro",
            mensagem_erro=f"Faltam informações para agendar: {', '.join(faltando)}.",
        )

    resultado = tools.criar_consulta(
        paciente_id=plano.paciente_id,
        profissional_id=plano.profissional_id,
        data_hora_iso=plano.data_hora_iso,
        tipo_consulta_id=plano.tipo_consulta_id,
    )
    if isinstance(resultado, dict) and resultado.get("erro"):
        tipo_erro = "conflito_409" if resultado.get("status") == 409 else "erro"
        return ResultadoExecucao(
            sucesso=False,
            tipo_erro=tipo_erro,
            dados=resultado,
            mensagem_erro=resultado.get("mensagem"),
        )
    return ResultadoExecucao(sucesso=True, dados=resultado)


def _executar_consulta_disponibilidade(plano: ResultadoPlanejador) -> ResultadoExecucao:
    if not plano.profissional_id:
        return ResultadoExecucao(
            sucesso=False,
            tipo_erro="erro",
            mensagem_erro="Preciso saber de qual profissional você quer ver a disponibilidade.",
        )
    consultas = tools.listar_consultas(profissional_id=plano.profissional_id)
    bloqueios = tools.listar_bloqueios(profissional_id=plano.profissional_id)
    return ResultadoExecucao(sucesso=True, dados={"consultas": consultas, "bloqueios": bloqueios})


def executar(plano: ResultadoPlanejador) -> ResultadoExecucao:
    """Executa (de verdade, contra a API) a ação correspondente à intenção do planejador.

    Para "consultar_paciente" e "outro", não há nada para executar - o trabalho relevante já
    foi feito pelo agente recuperador (RAG); o executor só sinaliza sucesso sem dados.
    """
    if plano.erro:
        return ResultadoExecucao(sucesso=False, tipo_erro="erro", mensagem_erro=plano.erro)

    if plano.intencao == "agendar_consulta":
        return _executar_agendamento(plano)
    if plano.intencao == "consultar_disponibilidade":
        return _executar_consulta_disponibilidade(plano)
    return ResultadoExecucao(sucesso=True, dados=None)
