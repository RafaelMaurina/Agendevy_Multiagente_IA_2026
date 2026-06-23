"""Agente planejador: interpreta o pedido em linguagem natural do usuário.

Responsabilidade única: extrair uma intenção estruturada (via LLM, em modo JSON forçado) e
resolver os nomes mencionados (paciente, profissional, tipo de consulta) para ids reais, usando
as tools de `agendevy_tools.py`. Nunca chama tools de agendamento/execução - isso é trabalho do
agente executor.

Se houver ambiguidade (mais de um paciente com nome parecido) ou um nome não encontrado, o
planejador NÃO adivinha - preenche `erro` com uma mensagem clara, para a interface de terminal
perguntar de volta ao usuário em vez de seguir com um id errado.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .. import llm
from ..tools import agendevy_tools as tools

INTENCOES_VALIDAS = {
    "agendar_consulta",
    "consultar_paciente",
    "consultar_disponibilidade",
    "outro",
}

_SCHEMA_INTENCAO = {
    "type": "object",
    "properties": {
        "intencao": {"type": "string", "enum": sorted(INTENCOES_VALIDAS)},
        "paciente_nome": {"type": ["string", "null"]},
        "profissional_nome": {"type": ["string", "null"]},
        "tipo_consulta_nome": {"type": ["string", "null"]},
        "data_hora_iso": {"type": ["string", "null"]},
        "pergunta_livre": {"type": ["string", "null"]},
    },
    "required": [
        "intencao",
        "paciente_nome",
        "profissional_nome",
        "tipo_consulta_nome",
        "data_hora_iso",
        "pergunta_livre",
    ],
}

# Assunção de fuso horário fixa para este projeto (clínica fictícia no Brasil). Se for adaptar
# para outro fuso, mude só esta constante.
FUSO_HORARIO_PADRAO = "-03:00"
FUSO = timezone(timedelta(hours=-3))


def _prompt_sistema(agora: datetime, tipos_consulta: list[str] | None = None, tem_historico: bool = False) -> str:
    dias_semana = [
        "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
        "sexta-feira", "sábado", "domingo",
    ]
    lista_tipos = ""
    if tipos_consulta:
        lista_tipos = (
            "\nTipos de atendimento que EXISTEM nesta clínica (use exatamente um destes nomes em "
            '"tipo_consulta_nome" quando o pedido se referir a um deles, mesmo que o usuário use '
            "uma abreviação ou sinônimo - ex: 'fisio' -> 'Fisioterapia - Sessão'):\n  - "
            + "\n  - ".join(tipos_consulta)
            + "\nSe o atendimento pedido não corresponder a nenhum destes, preencha "
            '"tipo_consulta_nome" com o que o usuário disse, do jeito que ele disse.\n'
        )
    bloco_historico = ""
    if tem_historico:
        bloco_historico = """
Há mensagens anteriores desta conversa antes do pedido atual (turnos "user" e "assistant").
Use-as para completar informações que o pedido atual não repete - isso é comum depois que o
assistente fez uma pergunta de esclarecimento. Exemplo: se a mensagem anterior do assistente
perguntou "Encontrei mais de um paciente parecido com 'Ana': Ana, Ana Paula. Qual deles?" e o
pedido atual é só "Ana Paula", combine esse nome com profissional/tipo/data já mencionados nos
turnos anteriores, em vez de extrair um pedido novo do zero (os campos que não mudaram não
precisam ser repetidos pelo usuário). Se o pedido atual já é autossuficiente ou é um assunto
totalmente diferente do histórico, ignore o histórico e extraia só do pedido atual.
"""
    return f"""Você é o módulo de interpretação de pedidos de uma clínica. Sua única tarefa é
extrair, do pedido do usuário, uma estrutura JSON com os campos definidos no schema. Não
converse, não explique, só extraia. Nunca invente nomes, datas ou tipos que o usuário não
mencionou - quando algo não foi dito, use null.
{bloco_historico}

Data e hora atuais: {agora.strftime('%Y-%m-%d %H:%M')} ({dias_semana[agora.weekday()]}).
Use isso para resolver datas relativas ("amanhã", "semana que vem", "sexta às 15h") em uma
data/hora ABSOLUTA no formato ISO 8601 com fuso "{FUSO_HORARIO_PADRAO}", ex:
"2026-07-10T14:00:00{FUSO_HORARIO_PADRAO}". Se o pedido não tiver data/hora (ex: uma pergunta
sobre o paciente, sem agendar nada), deixe "data_hora_iso" como null.
{lista_tipos}
Campos:
- "intencao": "agendar_consulta" (usuário quer marcar/remarcar uma consulta), "consultar_paciente"
  (usuário quer saber algo sobre um paciente, sem agendar nada), "consultar_disponibilidade"
  (usuário quer saber horários livres de um profissional) ou "outro" (qualquer outra coisa,
  incluindo saudações, agradecimentos, "sim"/"não" soltos, ou pedidos fora do escopo de uma
  agenda de clínica).
- "paciente_nome": nome do paciente mencionado, ou null se nenhum foi mencionado.
- "profissional_nome": nome do profissional mencionado, ou null.
- "tipo_consulta_nome": tipo de atendimento mencionado, ou null.
- "data_hora_iso": data/hora absoluta resolvida, ou null.
- "pergunta_livre": se intencao="consultar_paciente", o que exatamente o usuário quer saber
  sobre o paciente, em texto livre (ex: "tem alguma alergia?"). Para outras intenções, null.

Exemplos (formato esperado da saída):

Pedido: "marca uma fisio pra Maria Silva com o Dr. João sexta às 14h"
Saída: {{"intencao": "agendar_consulta", "paciente_nome": "Maria Silva", "profissional_nome": "Dr. João", "tipo_consulta_nome": "Fisioterapia - Sessão", "data_hora_iso": "<sexta-feira resolvida>T14:00:00{FUSO_HORARIO_PADRAO}", "pergunta_livre": null}}

Pedido: "o Pedro tem alguma alergia que eu preciso saber?"
Saída: {{"intencao": "consultar_paciente", "paciente_nome": "Pedro", "profissional_nome": null, "tipo_consulta_nome": null, "data_hora_iso": null, "pergunta_livre": "tem alguma alergia a medicamentos?"}}

Pedido: "quais horários a Dra. Camila tem livres amanhã?"
Saída: {{"intencao": "consultar_disponibilidade", "paciente_nome": null, "profissional_nome": "Dra. Camila", "tipo_consulta_nome": null, "data_hora_iso": "<amanhã resolvido>T00:00:00{FUSO_HORARIO_PADRAO}", "pergunta_livre": null}}

Pedido: "obrigado, era só isso"
Saída: {{"intencao": "outro", "paciente_nome": null, "profissional_nome": null, "tipo_consulta_nome": null, "data_hora_iso": null, "pergunta_livre": null}}
"""


@dataclass
class ResultadoPlanejador:
    intencao: str
    paciente_id: int | None = None
    profissional_id: int | None = None
    tipo_consulta_id: int | None = None
    tipo_consulta_nome: str | None = None
    data_hora_iso: str | None = None
    pergunta_livre: str | None = None
    erro: str | None = None
    bruto: dict = field(default_factory=dict)  # saída crua do LLM, útil para --verbose
    # Lista completa de tipos de consulta já buscada para montar o prompt (ver interpretar_pedido)
    # - guardada aqui para o revisor reusar em vez de chamar tools.listar_tipos_consulta() de novo.
    tipos_consulta_disponiveis: list[dict] = field(default_factory=list)


def _resolver_paciente(nome: str | None) -> tuple[int | None, str | None]:
    """Retorna (paciente_id, mensagem_de_erro). Erro != None significa "não resolveu"."""
    if not nome:
        return None, None
    # buscar_paciente_por_nome já faz substring; refinamos com _casar_por_nome para que, se o
    # nome dado bater exatamente com um paciente, não seja tratado como ambíguo só porque há
    # outros pacientes cujo nome contém o termo (ex: "Ana" exata vs "Ana Paula", "Mariana").
    candidatos = tools.buscar_paciente_por_nome(nome)
    if not candidatos:
        return None, f'Não encontrei nenhum paciente chamado "{nome}".'
    encontrados = _casar_por_nome(nome, candidatos) or candidatos
    if len(encontrados) > 1:
        nomes = ", ".join(p["nome"] for p in encontrados)
        return None, f'Encontrei mais de um paciente parecido com "{nome}": {nomes}. Qual deles?'
    return encontrados[0]["id"], None


def _casar_por_nome(termo: str, itens: list[dict]) -> list[dict]:
    """Casa `termo` contra a lista de itens (cada um com chave "nome"), em ordem de
    preferência: (1) match exato, (2) um item contém o termo como substring, (3) match por
    palavras - todas as palavras do termo aparecem no nome do item. Retorna a lista do
    primeiro nível que produzir algum resultado, para que um match exato nunca seja tratado
    como "ambíguo" só porque também há matches parciais.
    """
    t = termo.strip().lower()
    if not t:
        return []

    exatos = [i for i in itens if i["nome"].strip().lower() == t]
    if exatos:
        return exatos

    substring = [i for i in itens if t in i["nome"].lower()]
    if substring:
        return substring

    palavras = [p for p in t.split() if len(p) > 2]
    if palavras:
        por_palavra = [i for i in itens if all(p in i["nome"].lower() for p in palavras)]
        if por_palavra:
            return por_palavra

    return []


def _resolver_profissional(nome: str | None) -> tuple[int | None, str | None]:
    if not nome:
        return None, None
    encontrados = _casar_por_nome(nome, tools.listar_profissionais())
    if not encontrados:
        return None, f'Não encontrei nenhum profissional chamado "{nome}".'
    if len(encontrados) > 1:
        nomes = ", ".join(p["nome"] for p in encontrados)
        return None, f'Encontrei mais de um profissional parecido com "{nome}": {nomes}. Qual deles?'
    return encontrados[0]["id"], None


def _resolver_tipo_consulta(nome: str | None, tipos_disponiveis: list[dict]) -> tuple[int | None, str | None, str | None]:
    """Retorna (tipo_id, tipo_nome_real, mensagem_de_erro). `tipos_disponiveis` é a lista já
    buscada por `interpretar_pedido` - evita buscar a mesma lista de novo aqui."""
    if not nome:
        return None, None, None
    encontrados = _casar_por_nome(nome, tipos_disponiveis)
    if not encontrados:
        return None, None, f'Não encontrei nenhum tipo de atendimento chamado "{nome}".'
    if len(encontrados) > 1:
        nomes = ", ".join(t["nome"] for t in encontrados)
        return None, None, f'Encontrei mais de um tipo de atendimento parecido com "{nome}": {nomes}. Qual deles?'
    return encontrados[0]["id"], encontrados[0]["nome"], None


def interpretar_pedido(
    texto_usuario: str,
    agora: datetime | None = None,
    cliente=None,
    historico: list[dict] | None = None,
) -> ResultadoPlanejador:
    """Interpreta o pedido do usuário e resolve os nomes mencionados para ids reais.

    `agora` permite injetar uma data/hora fixa (testes); por padrão usa o momento real.
    `cliente` permite injetar um ollama.Client (ou substituto) para testes.
    `historico` permite passar turnos anteriores da conversa (lista de {"role": "user"|
    "assistant", "content": ...}, mais antigo primeiro) - usado para resolver pedidos de
    esclarecimento (ex: o turno anterior perguntou "qual paciente?" e o atual só responde o
    nome). Sem isso, cada pedido seria interpretado isoladamente, ignorando qualquer pergunta
    de esclarecimento feita no turno anterior.
    """
    # -03:00 fixo, não o fuso configurado no sistema operacional de quem está rodando - sem
    # isso, "amanhã"/"segunda-feira" podem resolver pro dia errado se a máquina não estiver
    # configurada para o horário de Brasília.
    agora = agora or datetime.now(FUSO)

    # Passa ao prompt a lista de tipos de atendimento que existem de fato no banco, para o
    # modelo mapear sinônimos/abreviações para o nome real (ex: "fisio" -> "Fisioterapia -
    # Sessão") em vez de inventar um nome que depois não vai casar com nada. A lista completa
    # (não só os nomes) é guardada no resultado para o revisor reusar, evitando buscar de novo.
    try:
        tipos_consulta_disponiveis = tools.listar_tipos_consulta()
    except Exception:
        tipos_consulta_disponiveis = []
    nomes_tipos_consulta = [t["nome"] for t in tipos_consulta_disponiveis]

    mensagens = [
        {"role": "system", "content": _prompt_sistema(agora, nomes_tipos_consulta, tem_historico=bool(historico))},
        *(historico or []),
        {"role": "user", "content": texto_usuario},
    ]
    bruto = llm.chat_json(
        mensagens=mensagens,
        schema=_SCHEMA_INTENCAO,
        cliente=cliente,
    )

    intencao = bruto.get("intencao") or "outro"
    if intencao not in INTENCOES_VALIDAS:
        intencao = "outro"

    paciente_id, erro_paciente = _resolver_paciente(bruto.get("paciente_nome"))
    profissional_id, erro_profissional = _resolver_profissional(bruto.get("profissional_nome"))
    tipo_id, tipo_nome, erro_tipo = _resolver_tipo_consulta(bruto.get("tipo_consulta_nome"), tipos_consulta_disponiveis)

    erro = erro_paciente or erro_profissional or erro_tipo

    return ResultadoPlanejador(
        intencao=intencao,
        paciente_id=paciente_id,
        profissional_id=profissional_id,
        tipo_consulta_id=tipo_id,
        tipo_consulta_nome=tipo_nome,
        data_hora_iso=bruto.get("data_hora_iso"),
        pergunta_livre=bruto.get("pergunta_livre"),
        tipos_consulta_disponiveis=tipos_consulta_disponiveis,
        erro=erro,
        bruto=bruto,
    )
