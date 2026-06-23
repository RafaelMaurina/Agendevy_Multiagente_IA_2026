"""Testes do matcher de nomes do planejador (_casar_por_nome) - não depende de LLM nem da API.

Cobre os casos que melhoraram a resolução de tipos/profissionais/pacientes:
- abreviação/sinônimo via match por palavras ("fisioterapia" -> "Fisioterapia - Sessão");
- preferência por match exato quando há também matches parciais (não tratar como ambíguo);
- ambiguidade real (mais de um match no mesmo nível) continua sendo sinalizada.

Rodar a partir da raiz do repositório:
    python -m agents.test_matcher
"""
from __future__ import annotations

from .agentes.planejador import _casar_por_nome


def _itens(*nomes):
    return [{"id": i, "nome": n} for i, n in enumerate(nomes, start=1)]


def test_match_por_palavra():
    tipos = _itens("Fisioterapia - Sessão", "Avaliação Postural", "Acupuntura")
    r = _casar_por_nome("fisioterapia", tipos)
    assert len(r) == 1 and r[0]["nome"] == "Fisioterapia - Sessão", r
    print("OK: 'fisioterapia' casa 'Fisioterapia - Sessão' por palavra.")


def test_substring():
    tipos = _itens("Consulta de rotina", "Retorno", "Avaliação")
    r = _casar_por_nome("rotina", tipos)
    assert len(r) == 1 and r[0]["nome"] == "Consulta de rotina", r
    print("OK: 'rotina' casa 'Consulta de rotina' por substring.")


def test_exato_vence_ambiguidade():
    # "Ana" exata não deve ser tratada como ambígua só porque há "Ana Paula" e "Mariana".
    pacientes = _itens("Ana", "Ana Paula", "Mariana")
    r = _casar_por_nome("Ana", pacientes)
    assert len(r) == 1 and r[0]["nome"] == "Ana", r
    print("OK: match exato 'Ana' não é tratado como ambíguo.")


def test_ambiguidade_real():
    # Sem match exato, dois itens contêm "Ana" como substring -> ambíguo (esperado).
    pacientes = _itens("Ana Paula", "Mariana Costa", "João")
    r = _casar_por_nome("ana", pacientes)
    assert len(r) == 2, r
    print("OK: ambiguidade real (2 matches por substring) é preservada.")


def test_sem_match():
    tipos = _itens("Fisioterapia - Sessão", "Acupuntura")
    r = _casar_por_nome("massoterapia", tipos)
    assert r == [], r
    print("OK: termo sem correspondência retorna vazio.")


def test_ignora_acento():
    # Busca sem acento deve casar com nome cadastrado com acento, e vice-versa.
    pacientes = _itens("João Pedro Alves")
    r = _casar_por_nome("Joao Pedro Alves", pacientes)
    assert len(r) == 1 and r[0]["nome"] == "João Pedro Alves", r
    print("OK: 'Joao Pedro Alves' (sem acento) casa 'João Pedro Alves' cadastrado com acento.")


def test_ignora_pontuacao_solta():
    # O LLM às vezes normaliza abreviações com ponto ("Jr." em vez de "Jr") na extração - isso
    # não deve impedir o match contra o nome cadastrado sem ponto.
    pacientes = _itens("Daniels Djalma Neto Jr")
    r = _casar_por_nome("Daniels Djalma Neto Jr.", pacientes)
    assert len(r) == 1 and r[0]["nome"] == "Daniels Djalma Neto Jr", r
    print("OK: 'Daniels Djalma Neto Jr.' (com ponto) casa 'Daniels Djalma Neto Jr' cadastrado sem ponto.")


if __name__ == "__main__":
    test_match_por_palavra()
    test_substring()
    test_exato_vence_ambiguidade()
    test_ambiguidade_real()
    test_sem_match()
    test_ignora_acento()
    test_ignora_pontuacao_solta()
    print("\nTodos os testes do matcher passaram.")
