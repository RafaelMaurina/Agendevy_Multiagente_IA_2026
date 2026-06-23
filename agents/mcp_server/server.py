"""Servidor MCP que expõe as tools de `agents.tools.agendevy_tools` para qualquer cliente MCP.

Cada tool aqui é só uma casca fina em torno de uma função já existente em agendevy_tools.py -
a lógica de chamada HTTP e tratamento de erro mora lá, não aqui. As docstrings abaixo são as
descrições que o LLM (do lado do cliente MCP que conectar aqui) vai ler para decidir quando
chamar cada tool, então são deliberadamente específicas sobre o que cada uma faz e quando
usá-la.

Nota: os 4 agentes do terminal (`agents/agentes/`, orquestrados por `agents/main.py`) NÃO
passam por este servidor nem pelo MCP - o executor chama `agendevy_tools` diretamente, sem
nenhuma rodada extra de LLM/MCP para decidir a chamada (decisão de design documentada em
`agentes/executor.py` e no `agents/README.md`). Este servidor é um caminho independente para as
mesmas tools, pensado para um cliente MCP externo genérico (ex: Claude Desktop, ou `mcp dev`
abaixo) - não é um componente do caminho de execução de `python -m agents.main`.

Para rodar (a partir da raiz do repositório, com o venv de agents/ ativado):
    python -m agents.mcp_server.server

Para inspecionar com a ferramenta de desenvolvimento do SDK MCP:
    cd agents && mcp dev mcp_server/server.py
"""
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from ..tools import agendevy_tools as tools

mcp = FastMCP(
    name="agendevy-tools",
    instructions=(
        "Tools para consultar e operar a agenda de uma clínica (Agendevy): pacientes, "
        "profissionais, tipos de atendimento, consultas, bloqueios de horário, saldo "
        "financeiro e anamnese. Todos os dados vêm de uma API real rodando localmente - "
        "não invente ids ou nomes que essas tools não retornarem."
    ),
)


@mcp.tool()
def listar_pacientes() -> list[dict]:
    """Lista todos os pacientes cadastrados na clínica, com id, nome, telefone, email e
    observações. Use para descobrir o id de um paciente quando já souber o nome exato, ou
    para responder perguntas gerais como "quantos pacientes existem"."""
    return tools.listar_pacientes()


@mcp.tool()
def buscar_paciente_por_nome(nome: str) -> list[dict]:
    """Busca pacientes pelo nome (busca parcial, sem diferenciar maiúsculas/minúsculas).
    Use esta tool quando o usuário mencionar um paciente pelo nome e você precisar do id dele
    para qualquer outra operação (criar consulta, checar saldo, ver anamnese etc.). Pode
    retornar mais de um paciente - se isso acontecer, peça confirmação de qual paciente antes
    de prosseguir, não escolha um arbitrariamente."""
    return tools.buscar_paciente_por_nome(nome)


@mcp.tool()
def buscar_paciente_por_id(paciente_id: int) -> dict:
    """Busca os dados completos de um paciente específico, já sabendo o id."""
    return tools.buscar_paciente_por_id(paciente_id)


@mcp.tool()
def listar_profissionais() -> list[dict]:
    """Lista todos os profissionais da clínica, com id, nome e especialidade. Use para
    descobrir o id de um profissional mencionado pelo nome."""
    return tools.listar_profissionais()


@mcp.tool()
def listar_tipos_consulta() -> list[dict]:
    """Lista todos os tipos de atendimento oferecidos pela clínica (nome, valor padrão em
    reais, duração em minutos). Use para descobrir o id de um tipo de consulta mencionado
    pelo nome, ou para saber a duração/valor antes de agendar."""
    return tools.listar_tipos_consulta()


@mcp.tool()
def listar_consultas(profissional_id: int | None = None, paciente_id: int | None = None) -> list[dict]:
    """Lista consultas já agendadas, opcionalmente filtradas por profissional e/ou paciente.
    Cada consulta vem com paciente, profissional, tipo_consulta, data_hora, horario_fim e
    status. Use para checar a agenda de um profissional antes de sugerir um horário, ou para
    ver o histórico de consultas de um paciente."""
    return tools.listar_consultas(profissional_id=profissional_id, paciente_id=paciente_id)


@mcp.tool()
def criar_consulta(
    paciente_id: int,
    profissional_id: int,
    data_hora_iso: str,
    tipo_consulta_id: int | None = None,
    nome_consulta: str | None = None,
) -> dict:
    """Cria uma nova consulta na agenda. `data_hora_iso` deve ser uma data/hora completa em
    formato ISO 8601 com fuso horário, por exemplo "2026-07-10T14:00:00-03:00" - nunca chame
    esta tool com uma data incompleta ou em linguagem natural, resolva a data exata antes.

    Se já existir uma consulta ou bloqueio de horário conflitante para o mesmo profissional, o
    resultado vem com {"erro": true, "status": 409, "mensagem": "..."} explicando o conflito -
    isso NÃO é uma falha do sistema, é uma resposta válida que deve ser repassada ao usuário
    (e, se possível, seguida de uma sugestão de horário alternativo usando listar_consultas e
    listar_bloqueios)."""
    return tools.criar_consulta(
        paciente_id=paciente_id,
        profissional_id=profissional_id,
        data_hora_iso=data_hora_iso,
        tipo_consulta_id=tipo_consulta_id,
        nome_consulta=nome_consulta,
    )


@mcp.tool()
def listar_bloqueios(profissional_id: int | None = None) -> list[dict]:
    """Lista bloqueios de horário (feriados, almoço, indisponibilidade), opcionalmente
    filtrados por profissional. Bloqueios sem profissional vinculado valem para todos e
    sempre aparecem no resultado. Use antes de sugerir um horário, para não sugerir um
    horário bloqueado."""
    return tools.listar_bloqueios(profissional_id=profissional_id)


@mcp.tool()
def checar_saldo_paciente(paciente_id: int) -> dict:
    """Retorna o saldo de crédito do paciente: saldo_monetario (R$ em crédito), sessoes_pagas,
    sessoes_consumidas e sessoes_disponiveis. Use antes de confirmar um agendamento de tipo de
    consulta pago, para avisar se o paciente está com pendência financeira ou se tem crédito
    disponível."""
    return tools.checar_saldo_paciente(paciente_id)


@mcp.tool()
def buscar_anamnese_paciente(paciente_id: int) -> list[dict]:
    """Retorna a anamnese do paciente: lista de perguntas com a respectiva resposta (ou null,
    se o paciente ainda não respondeu aquela pergunta). Use para responder perguntas como "o
    que preciso saber antes de atender esse paciente" ou para identificar alergias,
    contraindicações ou condições relevantes antes de confirmar um agendamento."""
    return tools.buscar_anamnese_paciente(paciente_id)


if __name__ == "__main__":
    mcp.run(transport="stdio")
