"""Constrói (ou reconstrói) as duas coleções do RAG a partir de dados reais.

- "conhecimento_clinico": lê todos os .md de rag/knowledge_base/ (conteúdo estático, versionado
  no repositório) e indexa cada arquivo como um documento.
- "contexto_pacientes": busca, via `agendevy_tools.py`, todos os pacientes reais cadastrados na
  API do Agendevy e indexa a anamnese respondida + as observações de cada um.

Reexecutável sem duplicar nada: toda indexação usa `upsert` com ids determinísticos (ver
vector_store.py) - rodar este script de novo só atualiza os documentos existentes.

Rodar a partir da raiz do repositório, com o backend do Agendevy rodando:
    python -m agents.rag.build_index
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from ..tools import agendevy_tools as tools
from . import vector_store as vs

KNOWLEDGE_BASE_DIR = Path(__file__).resolve().parent / "knowledge_base"


def _slugify(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    texto = texto.lower().strip()
    texto = re.sub(r"[^a-z0-9]+", "-", texto).strip("-")
    return texto


def _extrair_titulo(conteudo_md: str, fallback: str) -> str:
    """Extrai o título do documento a partir da primeira linha "# Título"."""
    primeira_linha = conteudo_md.strip().splitlines()[0] if conteudo_md.strip() else ""
    if primeira_linha.startswith("#"):
        return primeira_linha.lstrip("#").strip()
    return fallback


def construir_documentos_conhecimento() -> list[dict]:
    """Lê todos os .md de knowledge_base/ e monta os documentos para indexação.

    Distingue duas categorias pelo nome do arquivo: arquivos que começam com "politica-" ou
    "pagamento-" são conhecimento GERAL sobre a clínica (políticas, pagamento); os demais são
    documentos de um TIPO DE ATENDIMENTO específico. A distinção vai na metadata (`categoria`)
    para que buscas e respostas não confundam "uma política da clínica" com "um tipo de
    consulta que pode ser agendado".
    """
    documentos: list[dict] = []
    if not KNOWLEDGE_BASE_DIR.exists():
        print(f"[aviso] {KNOWLEDGE_BASE_DIR} não existe - nada para indexar em conhecimento_clinico.")
        return documentos

    arquivos = sorted(KNOWLEDGE_BASE_DIR.glob("*.md"))
    for caminho in arquivos:
        conteudo = caminho.read_text(encoding="utf-8")
        titulo = _extrair_titulo(conteudo, fallback=caminho.stem)
        eh_politica = caminho.stem.startswith(("politica-", "pagamento-"))
        if eh_politica:
            metadata = {"categoria": "politica_clinica", "titulo": titulo, "arquivo": caminho.name}
        else:
            metadata = {"categoria": "tipo_consulta", "tipo_consulta_nome": titulo, "arquivo": caminho.name}
        documentos.append(
            {
                "id": f"kb:{_slugify(caminho.stem)}",
                "texto": conteudo,
                "metadata": metadata,
            }
        )
    return documentos


def construir_documentos_pacientes() -> list[dict]:
    """Busca todos os pacientes reais via a API e monta os documentos de anamnese +
    observações para indexação na coleção de contexto por paciente."""
    documentos: list[dict] = []
    pacientes = tools.listar_pacientes()

    for paciente in pacientes:
        paciente_id = paciente["id"]
        nome = paciente.get("nome", "")

        observacoes = (paciente.get("observacoes") or "").strip()
        if observacoes:
            documentos.append(
                {
                    "id": f"paciente:{paciente_id}:observacao",
                    "texto": f"Observação cadastrada sobre {nome}: {observacoes}",
                    "metadata": {"paciente_id": paciente_id, "tipo": "observacao"},
                }
            )

        anamnese = tools.buscar_anamnese_paciente(paciente_id)
        for item in anamnese:
            resposta = item.get("resposta")
            if not resposta:
                continue  # paciente ainda não respondeu esta pergunta - nada a indexar
            pergunta_texto = item["pergunta"]["texto"]
            pergunta_id = item["pergunta"]["id"]
            resposta_texto = resposta.get("resposta") or ""
            if not resposta_texto.strip():
                continue
            documentos.append(
                {
                    "id": f"paciente:{paciente_id}:anamnese:{pergunta_id}",
                    "texto": f"Anamnese de {nome} - pergunta: {pergunta_texto} | resposta: {resposta_texto}",
                    "metadata": {"paciente_id": paciente_id, "tipo": "anamnese", "pergunta_id": pergunta_id},
                }
            )

    return documentos


def main() -> None:
    print("=== Indexando conhecimento_clinico (base estática) ===")
    docs_conhecimento = construir_documentos_conhecimento()
    print(f"{len(docs_conhecimento)} documento(s) encontrados em knowledge_base/.")
    vs.indexar_conhecimento_clinico(docs_conhecimento)
    print("OK.")

    print("\n=== Indexando contexto_pacientes (dados reais da API) ===")
    docs_pacientes = construir_documentos_pacientes()
    print(f"{len(docs_pacientes)} documento(s) de anamnese/observação encontrados (via API real).")
    vs.indexar_contexto_pacientes(docs_pacientes)
    print("OK.")

    colecao_conhecimento = vs._get_colecao(vs.COLECAO_CONHECIMENTO)
    colecao_pacientes = vs._get_colecao(vs.COLECAO_PACIENTES)
    print(
        f"\nTotais na base: conhecimento_clinico={colecao_conhecimento.count()} documentos, "
        f"contexto_pacientes={colecao_pacientes.count()} documentos."
    )


if __name__ == "__main__":
    main()
