"""Geração de embeddings locais para o RAG do Agendevy.

Usa `sentence-transformers` com o modelo `all-MiniLM-L6-v2` - roda 100% local, sem depender de
nenhuma API paga nem de um serviço externo precisando estar de pé (diferente de gerar
embeddings via Ollama, que exigiria o servidor do Ollama rodando só para isso).

O modelo é carregado uma única vez (lazy, no primeiro uso) e reaproveitado em todas as
chamadas seguintes - carregá-lo de novo a cada chamada seria caro e desnecessário.

Nota de ambiente: este módulo depende de `sentence-transformers` (e, por consequência, de
`torch`), listado em `requirements.txt` junto com `chromadb`. Se o ambiente de vocês tiver
pouco espaço em disco, considerem instalar o `torch` para CPU explicitamente antes de
`sentence-transformers`, para evitar baixar dependências de GPU (CUDA) que não serão usadas:
    pip install torch --index-url https://download.pytorch.org/whl/cpu
    pip install sentence-transformers
"""
from __future__ import annotations

from functools import lru_cache

NOME_MODELO = "all-MiniLM-L6-v2"


@lru_cache(maxsize=1)
def _get_modelo():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(NOME_MODELO)


def gerar_embeddings(textos: list[str]) -> list[list[float]]:
    """Gera um vetor de embedding por texto da lista de entrada, na mesma ordem.

    Os vetores são normalizados (norma L2 = 1), para que a distância de cosseno usada pelo
    Chroma corresponda diretamente a 1 - similaridade_de_cosseno.
    """
    if not textos:
        return []
    modelo = _get_modelo()
    vetores = modelo.encode(list(textos), normalize_embeddings=True)
    return vetores.tolist()
