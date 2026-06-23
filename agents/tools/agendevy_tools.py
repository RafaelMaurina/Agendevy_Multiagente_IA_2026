"""Tools que acessam a API REST real do Agendevy.

Cada função aqui é a "fonte de verdade" sobre como falar com o backend — tanto o servidor MCP
(mcp_server/server.py) quanto o wrapper de LLM (llm.py) reusam estas mesmas funções, em vez de
reimplementar chamadas HTTP em outro lugar.

Decisões importantes, verificadas contra a API real (não suposições):

- A API NÃO tem endpoints de busca/filtro por query string. `GET /pacientes`, `GET /consultas`,
  `GET /profissionais` e `GET /bloqueios` sempre retornam TODOS os registros. Toda função que
  precisa "buscar por nome" ou "filtrar por profissional" faz isso no lado do Python, sobre a
  lista completa.
- `POST /consultas` IGNORA qualquer campo "status" enviado no corpo — toda consulta criada nasce
  com status "aberta", independentemente do que for passado. Mudar o status exige um PUT
  separado (fora do escopo destas tools). Isso foi confirmado testando a API real; o exemplo de
  corpo de requisição no CLAUDE.md, que sugeria "status" como aceito na criação, está impreciso
  e deveria ser corrigido lá.
- Em conflito de horário, `POST /consultas` responde 409 com uma mensagem já pronta para
  exibição (ex: "Conflito de horário: profissional já possui consulta com <nome> das HH:MM às
  HH:MM."). As funções aqui repassam essa mensagem tal qual vem da API, sem reformular — decidir
  o que fazer com um conflito (sugerir horário alternativo etc.) é responsabilidade da camada de
  agente, não desta camada de tools.
- `GET /anamnese/paciente/:id` retorna uma lista de objetos `{"pergunta": {...}, "resposta":
  {...} | null}` — "resposta" é `null` quando o paciente ainda não respondeu aquela pergunta
  (confirmado contra a API real).

Nenhuma função aqui lança exceção para erros HTTP esperados (400/404/409) — todas capturam e
devolvem um dict `{"erro": True, "status": <código>, "mensagem": <mensagem da API>}`, para que a
camada de agente possa decidir o que fazer com o erro em vez de o programa quebrar.
"""
from __future__ import annotations

from typing import Any

import httpx

from .. import config


def _request(method: str, path: str, **kwargs: Any) -> Any:
    """Faz uma chamada HTTP à API do Agendevy e trata os casos de erro de forma uniforme.

    Retorna o JSON decodificado em caso de sucesso (dict ou list), ou um dict
    {"erro": True, "status": int, "mensagem": str} em caso de erro HTTP ou de conexão.
    """
    url = f"{config.AGENDEVY_API_URL}{path}"
    try:
        resp = httpx.request(method, url, timeout=config.HTTP_TIMEOUT, **kwargs)
    except httpx.RequestError as exc:
        return {
            "erro": True,
            "status": 0,
            "mensagem": (
                f"Sem conexão com a API do Agendevy em {config.AGENDEVY_API_URL}. "
                f"Verifique se o backend está rodando (npm run dev). Detalhe: {exc}"
            ),
        }

    if resp.status_code >= 400:
        try:
            body = resp.json()
            mensagem = body.get("message", resp.text)
        except ValueError:
            mensagem = resp.text
        return {"erro": True, "status": resp.status_code, "mensagem": mensagem}

    if resp.status_code == 204 or not resp.content:
        return {"ok": True}
    return resp.json()


def listar_pacientes() -> list[dict]:
    """Retorna todos os pacientes cadastrados na clínica."""
    resultado = _request("GET", "/pacientes")
    return resultado if isinstance(resultado, list) else []


def buscar_paciente_por_nome(nome: str) -> list[dict]:
    """Busca pacientes cujo nome contenha o texto informado.

    Busca parcial e case-insensitive, feita no lado do Python sobre a lista completa de
    pacientes (a API não expõe um endpoint de busca). Pode retornar mais de um resultado —
    quem chama esta tool deve tratar ambiguidade (mais de um paciente encontrado) antes de
    seguir adiante com qualquer ação.
    """
    pacientes = listar_pacientes()
    termo = nome.strip().lower()
    if not termo:
        return []
    return [p for p in pacientes if termo in (p.get("nome") or "").lower()]


def buscar_paciente_por_id(paciente_id: int) -> dict:
    """Busca um paciente específico pelo id."""
    return _request("GET", f"/pacientes/{paciente_id}")


def listar_profissionais() -> list[dict]:
    """Retorna todos os profissionais cadastrados na clínica."""
    resultado = _request("GET", "/profissionais")
    return resultado if isinstance(resultado, list) else []


def listar_tipos_consulta() -> list[dict]:
    """Retorna todos os tipos de atendimento cadastrados (nome, valor_padrao, duracao_minutos)."""
    resultado = _request("GET", "/tipos-consulta")
    return resultado if isinstance(resultado, list) else []


def listar_consultas(
    profissional_id: int | None = None,
    paciente_id: int | None = None,
) -> list[dict]:
    """Lista consultas, com filtro opcional por profissional e/ou paciente.

    O filtro é aplicado no lado do Python: a API sempre retorna a lista completa de consultas
    (com paciente, profissional e tipo_consulta já populados em cada item).
    """
    consultas = _request("GET", "/consultas")
    if not isinstance(consultas, list):
        return []
    if profissional_id is not None:
        consultas = [
            c for c in consultas
            if (c.get("profissional") or {}).get("id") == profissional_id
        ]
    if paciente_id is not None:
        consultas = [
            c for c in consultas
            if (c.get("paciente") or {}).get("id") == paciente_id
        ]
    return consultas


def criar_consulta(
    paciente_id: int,
    profissional_id: int,
    data_hora_iso: str,
    tipo_consulta_id: int | None = None,
    nome_consulta: str | None = None,
) -> dict:
    """Cria uma nova consulta na agenda.

    `data_hora_iso` deve ser uma string ISO 8601 com timezone, ex:
    "2026-07-10T14:00:00-03:00". A API calcula `horario_fim` automaticamente a partir da
    duração do tipo de consulta (ou 30 minutos, se nenhum tipo for informado).

    Importante: o campo "status" não é aceito nesta operação — toda consulta criada nasce com
    status "aberta". Em conflito de horário (já existe consulta ou bloqueio sobreposto para o
    mesmo profissional), a API responde 409; isso é repassado tal qual, sem reformular a
    mensagem aqui.
    """
    body: dict[str, Any] = {
        "paciente_id": paciente_id,
        "profissional_id": profissional_id,
        "data_hora": data_hora_iso,
    }
    if tipo_consulta_id is not None:
        body["tipo_consulta_id"] = tipo_consulta_id
    if nome_consulta is not None:
        body["nome_consulta"] = nome_consulta
    return _request("POST", "/consultas", json=body)


def listar_bloqueios(profissional_id: int | None = None) -> list[dict]:
    """Lista bloqueios de horário, com filtro opcional por profissional.

    Bloqueios sem profissional vinculado valem para todos os profissionais (ex: feriado da
    clínica) — por isso eles sempre são incluídos no resultado, independentemente do filtro.
    """
    bloqueios = _request("GET", "/bloqueios")
    if not isinstance(bloqueios, list):
        return []
    if profissional_id is not None:
        bloqueios = [
            b for b in bloqueios
            if b.get("profissional") is None or b.get("profissional", {}).get("id") == profissional_id
        ]
    return bloqueios


def checar_saldo_paciente(paciente_id: int) -> dict:
    """Retorna o saldo de crédito do paciente: saldo_monetario, sessoes_pagas,
    sessoes_consumidas e sessoes_disponiveis. Sempre calculado pela API, nunca armazenado."""
    return _request("GET", f"/comanda/paciente/{paciente_id}/saldo")


def buscar_anamnese_paciente(paciente_id: int) -> list[dict]:
    """Retorna a anamnese completa do paciente.

    Formato: lista de {"pergunta": {"texto": ..., "tipo": ..., ...}, "resposta": {"resposta":
    ...} | None}. "resposta" é None quando o paciente ainda não respondeu aquela pergunta —
    quem consome esta tool deve tratar esse caso, não assumir que toda pergunta tem resposta.
    """
    resultado = _request("GET", f"/anamnese/paciente/{paciente_id}")
    return resultado if isinstance(resultado, list) else []
