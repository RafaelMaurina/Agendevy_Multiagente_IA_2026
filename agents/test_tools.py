"""Script de teste manual das tools (`agendevy_tools.py`) contra a API real do Agendevy.

Pressupõe o backend rodando em http://localhost:3000 com pelo menos 1 paciente, 1 profissional
e 1 tipo de consulta cadastrados.

Rodar a partir da raiz do repositório:
    python -m agents.test_tools
"""
from __future__ import annotations

import json

import httpx

from . import config
from .tools import agendevy_tools as tools


def _print(titulo: str, valor) -> None:
    print(f"\n--- {titulo} ---")
    print(json.dumps(valor, indent=2, ensure_ascii=False, default=str))


def main() -> None:
    pacientes = tools.listar_pacientes()
    _print("listar_pacientes", pacientes)
    assert isinstance(pacientes, list) and len(pacientes) > 0, (
        "Esperava pelo menos 1 paciente cadastrado para rodar este teste."
    )
    paciente = pacientes[0]

    profissionais = tools.listar_profissionais()
    _print("listar_profissionais", profissionais)
    assert isinstance(profissionais, list) and len(profissionais) > 0
    profissional = profissionais[0]

    tipos = tools.listar_tipos_consulta()
    _print("listar_tipos_consulta", tipos)
    assert isinstance(tipos, list) and len(tipos) > 0
    tipo = tipos[0]

    encontrados = tools.buscar_paciente_por_nome(paciente["nome"][:5])
    _print(f"buscar_paciente_por_nome('{paciente['nome'][:5]}')", encontrados)
    assert any(p["id"] == paciente["id"] for p in encontrados), (
        "A busca por nome deveria encontrar o paciente usado no teste."
    )

    saldo = tools.checar_saldo_paciente(paciente["id"])
    _print(f"checar_saldo_paciente({paciente['id']})", saldo)
    assert "erro" not in saldo, "Não deveria dar erro ao checar saldo de um paciente existente."
    assert "saldo_monetario" in saldo

    anamnese = tools.buscar_anamnese_paciente(paciente["id"])
    _print(f"buscar_anamnese_paciente({paciente['id']})", anamnese)
    assert isinstance(anamnese, list)

    consultas_existentes = tools.listar_consultas(profissional_id=profissional["id"])
    _print(f"listar_consultas(profissional_id={profissional['id']})", consultas_existentes)
    assert isinstance(consultas_existentes, list)

    bloqueios = tools.listar_bloqueios(profissional_id=profissional["id"])
    _print(f"listar_bloqueios(profissional_id={profissional['id']})", bloqueios)
    assert isinstance(bloqueios, list)

    print("\n=== Teste de criação de consulta + conflito de horário (409) ===")
    data_hora_teste = "2026-08-15T10:00:00-03:00"
    primeira = tools.criar_consulta(
        paciente_id=paciente["id"],
        profissional_id=profissional["id"],
        data_hora_iso=data_hora_teste,
        tipo_consulta_id=tipo["id"],
    )
    _print("criar_consulta (1ª vez, deve ter sucesso)", primeira)

    consulta_criada_id = primeira.get("id") if isinstance(primeira, dict) else None
    try:
        assert "erro" not in primeira, f"Primeira criação não deveria falhar: {primeira}"
        assert primeira["status"] == "aberta", (
            "Confirma o comportamento real da API: toda consulta nasce com status 'aberta', "
            "mesmo que 'status' não tenha sido enviado no corpo."
        )

        segunda = tools.criar_consulta(
            paciente_id=paciente["id"],
            profissional_id=profissional["id"],
            data_hora_iso=data_hora_teste,
            tipo_consulta_id=tipo["id"],
        )
        _print("criar_consulta (2ª vez, MESMO horário - deve dar 409)", segunda)
        assert segunda.get("erro") is True and segunda.get("status") == 409, (
            "A segunda criação no mesmo horário/profissional deveria retornar conflito 409, "
            f"mas retornou: {segunda}"
        )

        print("\nTodos os asserts passaram - tools funcionando contra a API real.")
    finally:
        # Limpeza: este teste cria uma consulta real na API. Sem isso, rodar o teste de novo
        # colidiria com a consulta da execução anterior e o "deve ter sucesso" falharia por
        # conflito consigo mesmo (foi exatamente isso que aconteceu até esta correção).
        if consulta_criada_id is not None:
            httpx.delete(f"{config.AGENDEVY_API_URL}/consultas/{consulta_criada_id}", timeout=config.HTTP_TIMEOUT)


if __name__ == "__main__":
    main()
