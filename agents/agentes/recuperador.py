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

    # Busca conhecimento clínico apenas quando faz sentido: há um tipo de consulta concreto, ou
    # a intenção é agendar (caso em que indicações/contraindicações do procedimento ajudam). Para
    # uma consulta puramente sobre o paciente, sem procedimento envolvido, NÃO despejamos
    # documentos de procedimento na resposta - era o que gerava os trechos irrelevantes.
    query_conhecimento = _query_para_conhecimento(plano)
    if query_conhecimento and (plano.tipo_consulta_nome or plano.intencao == "agendar_consulta"):
        resultados = vs.buscar_conhecimento_clinico(query_conhecimento)
        contexto.trechos_conhecimento = _filtrar(resultados, LIMIAR_CONHECIMENTO, MAX_TRECHOS_CONHECIMENTO)

    return contexto
