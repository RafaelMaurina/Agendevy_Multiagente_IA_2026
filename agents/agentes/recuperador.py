"""Agente recuperador: busca contexto relevante via RAG.

Responsabilidade única: dado o que o planejador já resolveu (paciente, tipo de consulta,
pergunta livre), buscar os trechos mais relevantes nas duas coleções do vector store - nunca
chama tools de agendamento, nunca decide nada sobre a execução.

Calibração dos limiares (motivo de existirem dois, e não um só de 0.2 como na versão inicial):
os scores aqui são similaridade de cosseno com embeddings normalizados do `all-MiniLM-L6-v2`,
numa escala de 0 (nada a ver) a 1 (idêntico). Na prática, com esse modelo, um trecho realmente
relevante fica tipicamente acima de ~0.40, enquanto ruído de fundo (dois textos do mesmo
domínio "clínica" mas sobre assuntos diferentes) fica entre 0.20 e 0.35. O limiar antigo de
0.20 deixava esse ruído passar - era a causa de, numa pergunta sobre alergia, aparecerem
trechos de "RPG" e "Avaliação Postural" que nada tinham a ver. Os limiares abaixo são mais
exigentes; se você notar trechos claramente relevantes sendo descartados (ou ruído ainda
passando) depois de rodar com o `sentence-transformers` real, ajuste-os aqui - o ponto de
calibração está concentrado neste arquivo de propósito.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..rag import vector_store as vs
from .planejador import ResultadoPlanejador

# Contexto do paciente (anamnese/observações): é a informação mais crítica clinicamente, então
# preferimos um limiar moderado - melhor mostrar um trecho de relevância duvidosa do que esconder
# uma alergia. Ainda assim acima do antigo 0.2 para cortar ruído puro.
LIMIAR_PACIENTE = 0.30

# Conhecimento clínico geral: aqui podemos ser mais exigentes, porque um documento de tipo de
# consulta errado (ex: trazer "Acupuntura" numa conversa sobre fisioterapia) só polui a resposta,
# sem ganho. Exigimos similaridade claramente alta.
LIMIAR_CONHECIMENTO = 0.40

# Quantos trechos no máximo levar adiante de cada coleção (mesmo acima do limiar). Evita
# despejar vários documentos no revisor quando 1-2 já bastam.
MAX_TRECHOS_PACIENTE = 4
MAX_TRECHOS_CONHECIMENTO = 2


@dataclass
class ContextoRecuperado:
    trechos_paciente: list[dict] = field(default_factory=list)
    trechos_conhecimento: list[dict] = field(default_factory=list)

    @property
    def tem_algo(self) -> bool:
        return bool(self.trechos_paciente or self.trechos_conhecimento)


def _query_para_paciente(plano: ResultadoPlanejador) -> str:
    if plano.pergunta_livre:
        return plano.pergunta_livre
    if plano.tipo_consulta_nome:
        return f"alergias, contraindicações ou condições relevantes para {plano.tipo_consulta_nome}"
    return "alergias, contraindicações ou condições de saúde relevantes do paciente"


def _query_para_conhecimento(plano: ResultadoPlanejador) -> str | None:
    if plano.tipo_consulta_nome:
        return f"indicações, preparo e contraindicações de {plano.tipo_consulta_nome}"
    if plano.pergunta_livre:
        return plano.pergunta_livre
    return None


def _filtrar(resultados: list[dict], limiar: float, maximo: int) -> list[dict]:
    relevantes = [r for r in resultados if r["score"] >= limiar]
    relevantes.sort(key=lambda r: r["score"], reverse=True)
    return relevantes[:maximo]


def _pergunta_e_generica(pergunta: str | None) -> bool:
    """Detecta perguntas amplas ('o que preciso saber', 'tem algo importante', 'me fale sobre')
    em que TODA a anamnese é relevante e não se deve filtrar por uma palavra-chave específica."""
    if not pergunta:
        return True  # sem pergunta específica = trazer tudo
    p = pergunta.lower()
    gatilhos = [
        "o que", "preciso saber", "algo importante", "alguma coisa", "tem algo",
        "me fale", "fale sobre", "informações", "histórico", "antes de atender",
        "devo saber", "relevante",
    ]
    return any(g in p for g in gatilhos)


# Gatilhos de pergunta sobre o PROCEDIMENTO em si (indicações/contraindicações/preparo/
# recomendação de tratamento), diferente de pergunta sobre o paciente. Quando a pergunta tem um
# destes - ou menciona um tipo de atendimento pelo nome - buscamos a base de conhecimento
# clínico mesmo que o planejador não tenha extraído um tipo_consulta_nome estruturado (ex:
# "Valdivino pode fazer fisioterapia ou há contraindicações?" ou "qual atendimento é recomendado
# para dores crônicas?").
_GATILHOS_PROCEDIMENTO = (
    "contraindica", "contra-indica", "indicaç", "indicado", "recomend", "tratamento",
    "preparo", "pode fazer", "pode realizar", "serve para", "qual atendimento",
    "qual procedimento", "qual tratamento", "qual terapia",
)

# Palavras que aparecem em nomes de tipo mas são genéricas demais para, sozinhas, identificar um
# procedimento numa pergunta (evita falso positivo de "consulta"/"avaliação" etc.).
_PALAVRAS_TIPO_GENERICAS = {
    "consulta", "avaliacao", "avaliação", "sessao", "sessão", "rotina", "global",
    "clinico", "clínico", "exame",
}


def _pergunta_sobre_procedimento(pergunta: str | None, tipos_disponiveis: list[dict]) -> bool:
    if not pergunta:
        return False
    p = pergunta.lower()
    if any(g in p for g in _GATILHOS_PROCEDIMENTO):
        return True
    for t in tipos_disponiveis or []:
        for palavra in (t.get("nome") or "").lower().replace("-", " ").split():
            if len(palavra) > 4 and palavra not in _PALAVRAS_TIPO_GENERICAS and palavra in p:
                return True
    return False


def recuperar_contexto(plano: ResultadoPlanejador) -> ContextoRecuperado:
    contexto = ContextoRecuperado()

    if plano.paciente_id is not None:
        # Pergunta genérica ("o que preciso saber antes de atender X?") -> traz TODA a anamnese,
        # sem filtrar por similaridade a uma palavra (senão medicação contínua, peso etc. podem
        # ficar de fora de uma busca por "alergia"). Pergunta específica -> busca semântica.
        if plano.intencao == "consultar_paciente" and _pergunta_e_generica(plano.pergunta_livre):
            contexto.trechos_paciente = vs.listar_contexto_paciente(plano.paciente_id)
        else:
            query_paciente = _query_para_paciente(plano)
            resultados = vs.buscar_contexto_paciente(plano.paciente_id, query_paciente)
            contexto.trechos_paciente = _filtrar(resultados, LIMIAR_PACIENTE, MAX_TRECHOS_PACIENTE)

    # Busca conhecimento clínico quando faz sentido: há um tipo de consulta concreto, a intenção
    # é agendar (indicações/contraindicações do procedimento ajudam), OU a própria pergunta é
    # sobre um procedimento (ex: "pode fazer fisioterapia?", "qual atendimento para dor crônica?").
    # Para uma consulta puramente sobre o paciente (alergia, medicação), NÃO despejamos documentos
    # de procedimento - era o que gerava os trechos irrelevantes. O limiar (0.40) faz a triagem
    # final, então um falso positivo na condição abaixo só custa uma busca que volta vazia.
    query_conhecimento = _query_para_conhecimento(plano)
    busca_faz_sentido = (
        plano.tipo_consulta_nome
        or plano.intencao == "agendar_consulta"
        or _pergunta_sobre_procedimento(plano.pergunta_livre, plano.tipos_consulta_disponiveis)
    )
    if query_conhecimento and busca_faz_sentido:
        resultados = vs.buscar_conhecimento_clinico(query_conhecimento)
        contexto.trechos_conhecimento = _filtrar(resultados, LIMIAR_CONHECIMENTO, MAX_TRECHOS_CONHECIMENTO)

    return contexto
