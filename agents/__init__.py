"""Camada de agentes (LLM local + MCP + RAG) do projeto Agendevy.

Roda como um pacote Python independente, ao lado de backend/ e frontend_novo/. Os módulos
aqui nunca importam código TypeScript do backend diretamente — toda comunicação com o
Agendevy acontece via HTTP, exatamente como o frontend_novo já faz.

Convenção de execução: sempre a partir da raiz do repositório (o diretório que contém
agents/, backend/ e frontend_novo/), usando `python -m agents.<modulo>`.
"""
