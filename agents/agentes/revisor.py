"""Agente revisor: valida o resultado do executor contra as regras de negócio reais do
Agendevy, e compõe a resposta final em linguagem natural.

Importante: as regras de negócio em si (conflito de horário, cálculo de saldo) NUNCA são
reimplementadas aqui - continuam vivendo só no backend TypeScript. Este agente só LÊ o que a
API já decidiu (um 409, um saldo pendente) e decide como reagir: sugerir horário alternativo,
incluir um aviso, ou simplesmente confirmar.

A composição da resposta final em texto natural é delegada ao LLM (`llm.chat_texto`) - mas
todos os FATOS que entram nessa composição (houve conflito? qual o saldo? o que a anamnese
diz?) são calculados em Python antes, de forma determinística. O LLM só tem o trabalho de
"traduzir fatos em texto natural e sinalizar o que for clinicamente relevante nos trechos de
anamnese/observação retornados" - não o de decidir os fatos em si.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .. import llm
from ..tools import agendevy_tools as tools
from .executor import ResultadoExecucao
from .planejador import FUSO_HORARIO_PADRAO, ResultadoPlanejador
from .recuperador import ContextoRecuperado

FUSO = timezone(timedelta(hours=-3))  # mesmo fuso fixo assumido em planejador.py

JANELA_INICIO_HORA = 8
JANELA_FIM_HORA = 18
PASSO_MINUTOS = 30
MAX_SUGESTOES = 2


def _parse_iso_para_fuso_local(valor_iso: str) -> datetime:
    """Converte qualquer timestamp ISO (incluindo os 'Z' em UTC devolvidos pela API) para um
    datetime aware no fuso local fixo do projeto."""
    dt = datetime.fromisoformat(valor_iso.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=FUSO)
    return dt.astimezone(FUSO)


def _intervalos_ocupados(profissional_id: int, dia: datetime) -> list[tuple[datetime, datetime]]:
    inicio_dia = dia.replace(hour=0, minute=0, second=0, microsecond=0)
    fim_dia = inicio_dia + timedelta(days=1)
    ocupados: list[tuple[datetime, datetime]] = []

    for c in tools.listar_consultas(profissional_id=profissional_id):
        if c.get("status") == "cancelada":
            continue
        inicio = _parse_iso_para_fuso_local(c["data_hora"])
        if not (inicio_dia <= inicio < fim_dia):
            continue
        fim = (
            _parse_iso_para_fuso_local(c["horario_fim"])
            if c.get("horario_fim")
            else inicio + timedelta(minutes=30)
        )
        ocupados.append((inicio, fim))

    for b in tools.listar_bloqueios(profissional_id=profissional_id):
        inicio = _parse_iso_para_fuso_local(b["inicio"])
        fim = _parse_iso_para_fuso_local(b["fim"])
        if fim > inicio_dia and inicio < fim_dia:
            ocupados.append((max(inicio, inicio_dia), min(fim, fim_dia)))

    return sorted(ocupados)


def sugerir_horarios_alternativos(
    profissional_id: int,
    data_hora_desejada_iso: str,
    duracao_minutos: int = 30,
) -> list[str]:
    """Devolve até MAX_SUGESTOES horários livres (ISO 8601) no mesmo dia do horário desejado,
    o mais próximo possível dele, sem sobrepor consultas/bloqueios existentes."""
    desejado = _parse_iso_para_fuso_local(data_hora_desejada_iso)
    ocupados = _intervalos_ocupados(profissional_id, desejado)
    duracao = timedelta(minutes=duracao_minutos)

    inicio_janela = desejado.replace(hour=JANELA_INICIO_HORA, minute=0, second=0, microsecond=0)
    fim_janela = desejado.replace(hour=JANELA_FIM_HORA, minute=0, second=0, microsecond=0)

    candidatos: list[datetime] = []
    cursor = inicio_janela
    while cursor + duracao <= fim_janela:
        candidatos.append(cursor)
        cursor += timedelta(minutes=PASSO_MINUTOS)

    def livre(candidato: datetime) -> bool:
        fim_candidato = candidato + duracao
        return all(not (candidato < fim_oc and inicio_oc < fim_candidato) for inicio_oc, fim_oc in ocupados)

    candidatos_livres = [c for c in candidatos if livre(c)]
    # Ordena pela proximidade em relação ao horário originalmente desejado.
    candidatos_livres.sort(key=lambda c: abs((c - desejado).total_seconds()))

    return [c.strftime(f"%Y-%m-%dT%H:%M:00{FUSO_HORARIO_PADRAO}") for c in candidatos_livres[:MAX_SUGESTOES]]


@dataclass
class ResultadoRevisor:
    resposta_final: str
    sugestoes_horario: list[str]
    aviso_financeiro: str | None
    resumo_para_debug: dict


def _checar_pendencia_financeira(plano: ResultadoPlanejador) -> str | None:
    if not plano.paciente_id or not plano.tipo_consulta_id:
        return None
    tipos = {t["id"]: t for t in plano.tipos_consulta_disponiveis}
    tipo = tipos.get(plano.tipo_consulta_id)
    if not tipo or tipo.get("valor_padrao") is None:
        return None  # tipo gratuito ou sem valor definido - nada a avisar

    saldo = tools.checar_saldo_paciente(plano.paciente_id)
    if saldo.get("erro"):
        return None
    valor = float(tipo["valor_padrao"])
    if saldo.get("saldo_monetario", 0) < valor and saldo.get("sessoes_disponiveis", 0) <= 0:
        return (
            f"Este atendimento ({tipo['nome']}, R$ {valor:.2f}) não tem crédito suficiente "
            f"cobrindo o valor - o lançamento financeiro deve ficar pendente até o pagamento."
        )
    return None


def _montar_resumo(
    plano: ResultadoPlanejador,
    execucao: ResultadoExecucao,
    contexto: ContextoRecuperado,
    sugestoes: list[str],
    aviso_financeiro: str | None,
) -> str:
    linhas = [f"Intenção identificada: {plano.intencao}."]

    # Âncora explícita por tipo de intenção. Sem isso, o modelo local tende a "puxar" toda
    # resposta para o tema agendamento (é o caso de uso dominante do assistente) e responde
    # sobre marcar consulta mesmo quando o usuário só fez uma pergunta sobre o paciente.
    if plano.intencao == "consultar_paciente":
        linhas.append(
            "Esta é uma CONSULTA DE INFORMAÇÃO sobre o paciente - o usuário NÃO pediu para "
            "agendar nada. Não peça profissional, data ou horário; não fale em marcar consulta. "
            "Responda apenas com base nas informações do paciente listadas abaixo."
        )
    elif plano.intencao == "consultar_disponibilidade":
        linhas.append(
            "O usuário quer saber sobre disponibilidade/agenda - ainda NÃO pediu para confirmar "
            "um agendamento. Não declare nenhuma consulta como criada."
        )

    if execucao.tipo_erro == "conflito_409":
        linhas.append(f"Tentativa de agendamento falhou por conflito de horário: {execucao.mensagem_erro}")
        if sugestoes:
            linhas.append("Horários alternativos livres no mesmo dia: " + ", ".join(sugestoes))
        else:
            linhas.append("Não há horário livre no mesmo dia dentro do horário comercial (08h-18h).")
    elif execucao.tipo_erro == "erro":
        linhas.append(f"A operação não pôde ser concluída: {execucao.mensagem_erro}")
    elif plano.intencao == "agendar_consulta" and execucao.sucesso:
        dados = execucao.dados or {}
        tipo_nome = (dados.get("tipo_consulta") or {}).get("nome") or plano.tipo_consulta_nome or "consulta"
        linhas.append(
            "Consulta CRIADA E JÁ SALVA com sucesso (não é uma ação pendente - já aconteceu): "
            f"tipo de atendimento={tipo_nome}, "
            f"paciente={dados.get('paciente', {}).get('nome')}, "
            f"profissional={dados.get('profissional', {}).get('nome')}, "
            # plano.data_hora_iso é o horário local (-03:00) que foi de fato solicitado e
            # enviado para a API - NUNCA usar dados.get('data_hora') aqui, que vem em UTC
            # (ex.: "13:00" em vez de "10:00") e gera uma confirmação com o horário errado.
            f"data_hora_local={plano.data_hora_iso}, status={dados.get('status')}."
        )
        if aviso_financeiro:
            linhas.append(f"Aviso financeiro: {aviso_financeiro}")

    if contexto.trechos_paciente:
        linhas.append("Trechos relevantes do histórico do paciente (anamnese/observações):")
        for t in contexto.trechos_paciente:
            linhas.append(f"  - {t['texto']}")
    elif plano.paciente_id and plano.intencao == "consultar_paciente":
        linhas.append("Nenhuma informação de anamnese ou observação relevante encontrada para este paciente.")

    if contexto.trechos_conhecimento:
        linhas.append("Trechos relevantes da base de conhecimento clínico:")
        for t in contexto.trechos_conhecimento:
            linhas.append(f"  - {t['texto']}")

    return "\n".join(linhas)


_PROMPT_SISTEMA_REVISOR = """Você é o módulo que compõe a resposta final de um assistente de
agenda de clínica, em português, para ser lida por um recepcionista no terminal. Você recebe
um resumo já com todos os fatos apurados (não invente fatos novos, nem números, nem nomes que
não estejam no resumo - se uma informação não estiver no resumo, diga que não sabe ou peça a
informação que falta, não complete com algo plausível). Sua tarefa:

1. Escreva uma resposta clara e curta (poucas frases), em tom profissional e direto.
2. ATENÇÃO à intenção declarada no início do resumo. Se o resumo diz que é uma "CONSULTA DE
   INFORMAÇÃO sobre o paciente", responda APENAS o que foi perguntado sobre o paciente, com
   base nas informações listadas - não mencione agendamento, não peça profissional/data/horário,
   não diga que faltam informações para agendar. O usuário não está marcando nada.
3. REGRA CRÍTICA sobre agendamento que já foi concluído com sucesso: se o resumo diz que a
   consulta já foi "CRIADA E JÁ SALVA", **nunca pergunte "você gostaria de confirmar?"** -
   isso é enganoso, porque a ação já aconteceu, não está pendente. Em vez disso, declare o
   fato como confirmação do que já foi feito, neste formato:
   "Confirmado: consulta de <tipo de atendimento> para o paciente <paciente> com o
   profissional <profissional> salva para <data e horário>." - preenchendo cada campo só com
   o que vier no resumo. Pode terminar com uma pergunta de acompanhamento (ex: "precisa de
   mais alguma coisa?"), mas nunca uma pergunta que sugira que o agendamento ainda não
   aconteceu.
4. Se houver conflito de horário com sugestões de horário alternativo, isso SIM é uma decisão
   pendente de verdade - pergunte ao usuário se quer confirmar um dos horários alternativos.
5. Se houver aviso financeiro, inclua-o.
6. Se houver trechos de anamnese/observação do paciente, e algum deles parecer clinicamente
   relevante (alergia, contraindicação, condição crônica, uso de medicação que possa interagir
   com o atendimento), destaque isso explicitamente na resposta. Se nenhum trecho for
   clinicamente relevante, não invente uma preocupação - apenas resuma a informação encontrada
   ou diga que nada de relevante foi encontrado.
7. Se faltar uma informação necessária para concluir a ação (ex: "faltam informações para
   agendar: profissional"), diga exatamente isso e pergunte pela informação que falta - nunca
   invente um valor (nome, horário, profissional) que não esteja no resumo só para parecer
   uma resposta completa.
8. Nunca invente ids, nomes ou horários que não estejam no resumo recebido."""


def revisar(
    plano: ResultadoPlanejador,
    execucao: ResultadoExecucao,
    contexto: ContextoRecuperado,
    cliente=None,
) -> ResultadoRevisor:
    sugestoes: list[str] = []
    if execucao.tipo_erro == "conflito_409" and plano.profissional_id and plano.data_hora_iso:
        duracao = 30
        if plano.tipo_consulta_id:
            tipos = {t["id"]: t for t in plano.tipos_consulta_disponiveis}
            tipo = tipos.get(plano.tipo_consulta_id)
            if tipo:
                duracao = tipo.get("duracao_minutos", 30)
        sugestoes = sugerir_horarios_alternativos(plano.profissional_id, plano.data_hora_iso, duracao)

    aviso_financeiro = None
    if plano.intencao == "agendar_consulta" and execucao.sucesso:
        aviso_financeiro = _checar_pendencia_financeira(plano)

    resumo = _montar_resumo(plano, execucao, contexto, sugestoes, aviso_financeiro)

    resposta_final = llm.chat_texto(
        mensagens=[
            {"role": "system", "content": _PROMPT_SISTEMA_REVISOR},
            {"role": "user", "content": resumo},
        ],
        cliente=cliente,
    )

    return ResultadoRevisor(
        resposta_final=resposta_final,
        sugestoes_horario=sugestoes,
        aviso_financeiro=aviso_financeiro,
        resumo_para_debug={"resumo_textual": resumo},
    )
