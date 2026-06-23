"""Configuração centralizada da camada de agentes do Agendevy.

Tudo é lido de variáveis de ambiente, com defaults sensatos para desenvolvimento local.
Nenhuma credencial fica hardcoded aqui — a API do Agendevy não exige autenticação hoje,
então não há token/chave a configurar.
"""
import os

# URL base da API REST do Agendevy (já incluindo o prefixo /api).
AGENDEVY_API_URL = os.environ.get("AGENDEVY_API_URL", "http://localhost:3000/api")

# Modelo local servido pelo Ollama. llama3.1:8b foi escolhido por suportar tool-calling
# nativamente e rodar em hardware modesto (GPU de consumo ou CPU, mais lento).
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1:8b")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")

# Timeout (segundos) para cada chamada HTTP à API do Agendevy.
HTTP_TIMEOUT = float(os.environ.get("AGENDEVY_HTTP_TIMEOUT", "10"))
