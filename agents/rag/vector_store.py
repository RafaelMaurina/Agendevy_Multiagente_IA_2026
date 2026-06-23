"""Armazenamento e busca vetorial (ChromaDB) para o RAG do Agendevy.

Duas coleções, propositalmente separadas:

- "conhecimento_clinico": base estática (um documento por tipo de consulta, ver
  knowledge_base/). Resposta a perguntas gerais sobre indicações/contraindicações/preparo.
- "contexto_pacientes": contexto dinâmico por paciente (anamnese + observações), com metadata
  "paciente_id" para permitir filtrar a busca a um paciente específico.

Os embeddings são calculados explicitamente por `embeddings.gerar_embeddings()` e passados já
prontos para o Chroma - toda coleção é criada com `embedding_function=None` para o Chroma
nunca tentar usar sua própria função de embedding default (que baixaria seu próprio modelo por
conta própria, fora do nosso controle).

Indexação é sempre via `upsert` (nunca `add` puro) - chamar a indexação de novo com os mesmos
ids atualiza os documentos existentes em vez de duplicá-los.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import chromadb

from . import embeddings as emb

DATA_DIR = Path(__file__).resolve().parent / "data"

COLECAO_CONHECIMENTO = "conhecimento_clinico"
COLECAO_PACIENTES = "contexto_pacientes"

_cliente: chromadb.ClientAPI | None = None


def _get_cliente() -> chromadb.ClientAPI:
    global _cliente
    if _cliente is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _cliente = chromadb.PersistentClient(path=str(DATA_DIR))
    return _cliente


def _get_colecao(nome: str):
    return _get_cliente().get_or_create_collection(
        name=nome,
        embedding_function=None,
        metadata={"hnsw:space": "cosine"},
    )


def _indexar(nome_colecao: str, documentos: list[dict[str, Any]]) -> None:
    """documentos: lista de {"id": str, "texto": str, "metadata": dict}."""
    if not documentos:
        return
    colecao = _get_colecao(nome_colecao)
    vetores = emb.gerar_embeddings([d["texto"] for d in documentos])
    colecao.upsert(
        ids=[d["id"] for d in documentos],
        embeddings=vetores,
        documents=[d["texto"] for d in documentos],
        metadatas=[d["metadata"] for d in documentos],
    )


def indexar_conhecimento_clinico(documentos: list[dict[str, Any]]) -> None:
    """Indexa (upsert) documentos na coleção de conhecimento clínico geral."""
    _indexar(COLECAO_CONHECIMENTO, documentos)


def indexar_contexto_pacientes(documentos: list[dict[str, Any]]) -> None:
    """Indexa (upsert) documentos na coleção de contexto por paciente. Cada documento deve
    ter metadata["paciente_id"] preenchido, para permitir filtrar a busca depois."""
    _indexar(COLECAO_PACIENTES, documentos)


def _formatar_resultado(resultado) -> list[dict]:
    docs = (resultado.get("documents") or [[]])[0]
    metadatas = (resultado.get("metadatas") or [[]])[0]
    distancias = (resultado.get("distances") or [[]])[0]
    saida = []
    for texto, metadata, distancia in zip(docs, metadatas, distancias):
        saida.append(
            {
                "texto": texto,
                # Coleções usam espaço de cosseno (hnsw:space=cosine) e embeddings normalizados,
                # então distância de cosseno = 1 - similaridade. Convertendo de volta para
                # "score" (1.0 = idêntico, 0.0 = ortogonal) porque é mais intuitivo de ler.
                "score": round(1 - distancia, 4),
                "metadata": metadata,
            }
        )
    return saida


def buscar_conhecimento_clinico(query: str, top_k: int = 3) -> list[dict]:
    """Busca os `top_k` documentos mais relevantes na base de conhecimento clínico geral."""
    colecao = _get_colecao(COLECAO_CONHECIMENTO)
    if colecao.count() == 0:
        return []
    vetor = emb.gerar_embeddings([query])[0]
    resultado = colecao.query(
        query_embeddings=[vetor],
        n_results=min(top_k, colecao.count()),
        include=["documents", "metadatas", "distances"],
    )
    return _formatar_resultado(resultado)


def buscar_contexto_paciente(paciente_id: int, query: str, top_k: int = 5) -> list[dict]:
    """Busca os `top_k` documentos mais relevantes no contexto de UM paciente específico
    (anamnese + observações). Retorna lista vazia se o paciente não tiver nenhum documento
    indexado - não é um erro, é um resultado válido."""
    colecao = _get_colecao(COLECAO_PACIENTES)
    existentes = colecao.get(where={"paciente_id": paciente_id}, include=[])
    total_do_paciente = len(existentes.get("ids") or [])
    if total_do_paciente == 0:
        return []
    vetor = emb.gerar_embeddings([query])[0]
    resultado = colecao.query(
        query_embeddings=[vetor],
        n_results=min(top_k, total_do_paciente),
        where={"paciente_id": paciente_id},
        include=["documents", "metadatas", "distances"],
    )
    return _formatar_resultado(resultado)


def listar_contexto_paciente(paciente_id: int) -> list[dict]:
    """Retorna TODOS os documentos de contexto (anamnese + observações) de um paciente, sem
    busca semântica nem filtro de relevância. Usado quando o usuário faz uma pergunta genérica
    ("o que preciso saber antes de atender fulano?") - nesse caso tudo na anamnese é
    potencialmente relevante (alergias, medicação contínua, peso/altura), e filtrar por
    similaridade a uma palavra-chave deixaria informação importante de fora. Retorna no formato
    de _formatar_resultado, com score fixo em 1.0 (não houve ranqueamento)."""
    colecao = _get_colecao(COLECAO_PACIENTES)
    dados = colecao.get(where={"paciente_id": paciente_id}, include=["documents", "metadatas"])
    docs = dados.get("documents") or []
    metadatas = dados.get("metadatas") or []
    return [
        {"texto": texto, "score": 1.0, "metadata": metadata}
        for texto, metadata in zip(docs, metadatas)
    ]
