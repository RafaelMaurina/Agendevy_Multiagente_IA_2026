# Agendevy - Camada de agentes (sistema multiagente)

> Só quer **rodar**? Ver **[`../COMO_RODAR.md`](../COMO_RODAR.md)** (guia enxuto de execução).
> Quer saber **o que falta até a entrega**? Ver **[`../PROXIMOS_PASSOS.md`](../PROXIMOS_PASSOS.md)**.
> Este arquivo é a documentação **técnica** da camada de agentes, organizada pelas 3 etapas de
> implementação - útil para entender as decisões de arquitetura, não como passo a passo.

Esta pasta implementa o sistema multiagente completo sobre a API real do Agendevy, em três
camadas: as **tools** + **servidor MCP** + wrapper de tool-calling sobre o Ollama (Etapa 1); a
base de conhecimento + embeddings + **RAG** com ChromaDB (Etapa 2); e os **4 agentes**
(planejador, recuperador, executor, revisor) orquestrados com uma interface de terminal
(Etapa 3). As seções abaixo seguem essa mesma ordem.

## Setup

```bash
# 1. Backend do Agendevy precisa estar rodando (em outro terminal)
cd backend
npm install
npm run typeorm -- migration:run
npm run dev          # http://localhost:3000

# 2. Ambiente Python desta pasta
cd agents
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 3. Modelo local (em outro terminal, com o Ollama já instalado)
ollama pull llama3.1:8b
```

Todos os comandos abaixo assumem que você está na **raiz do repositório** (a pasta que contém
`agents/`, `backend/` e `frontend_novo/`), com o venv de `agents/` ativado - os módulos são
pacotes Python (`agents.tools.agendevy_tools`, `agents.llm` etc.), não scripts soltos.

## O que já está implementado

- `config.py` - configuração via variáveis de ambiente (`AGENDEVY_API_URL`, `OLLAMA_MODEL`,
  `OLLAMA_HOST`).
- `tools/agendevy_tools.py` - 10 funções que acessam a API real: pacientes, profissionais,
  tipos de consulta, consultas (listar e criar), bloqueios, saldo financeiro e anamnese.
- `mcp_server/server.py` - servidor MCP (`FastMCP`) expondo essas 10 funções como tools MCP.
- `llm.py` - `chat_com_tools()`: loop genérico de tool-calling sobre o Ollama. Recebe as
  próprias funções Python como tools (o cliente `ollama` gera o schema JSON automaticamente a
  partir da assinatura e da docstring de cada função - não escrevemos schema à mão em
  nenhum lugar, então MCP e LLM nunca podem ficar dessincronizados entre si).

## Como testar

### 1. Tools contra a API real
```bash
python -m agents.test_tools
```
Cria pacientes/consultas de teste e valida, entre outras coisas, que tentar agendar duas
consultas no mesmo horário/profissional retorna conflito 409 - sem derrubar o programa.
**Já validado**: todos os asserts passam contra o backend rodando localmente.

### 2. Servidor MCP
```bash
cd agents && mcp dev mcp_server/server.py
```
Abre a ferramenta de inspeção do SDK MCP, listando as 10 tools registradas com seus schemas.
**Já validado**: o servidor inicia e lista corretamente todas as tools esperadas.

### 3. Loop de tool-calling (sem precisar do Ollama rodando)
```bash
python -m agents.test_llm_loop
```
Testa o *mecanismo* de `chat_com_tools()` (executar tool, devolver resultado, parar no texto
final, não rodar pra sempre, não quebrar com argumento inválido) usando um cliente Ollama
falso - não depende de o Ollama estar instalado. **Já validado**: todos os 4 cenários passam.

### 4. Tool-calling com o modelo real (precisa do Ollama rodando - não testado aqui)
O ambiente onde esta implementação foi gerada não tem acesso de rede para instalar/baixar o
Ollama, então **este passo específico não foi validado automaticamente** e precisa ser
conferido por vocês:
```bash
python -c "
from agents import llm
from agents.tools import agendevy_tools as tools
resultado = llm.chat_com_tools(
    mensagens=[{'role': 'user', 'content': 'quantos pacientes estão cadastrados?'}],
    tools=[tools.listar_pacientes],
)
print(resultado['resposta'])
print(resultado['chamadas'])
"
```
Esperado: `resultado['chamadas']` deve conter uma chamada real a `listar_pacientes`, e
`resultado['resposta']` deve mencionar o número correto de pacientes. Se o modelo responder
sem chamar a tool (alucinando um número), revise o prompt da mensagem `user` para deixar mais
explícito que ele deve consultar a tool antes de responder - comportamento conhecido de
modelos locais menores.

## Descoberta importante durante a implementação

Testando a API real, confirmamos que **`POST /consultas` ignora qualquer campo `status`
enviado no corpo** - toda consulta criada nasce com `status: "aberta"`, independente do que
for passado. Mudar o status exige um `PUT /consultas/:id` separado. A tool `criar_consulta`
já reflete isso na docstring. Se o `CLAUDE.md` do projeto documentar um exemplo de corpo de
`POST /consultas` com `"status": "agendada"`, esse exemplo está impreciso e vale corrigir lá
também.

## Próximos passos
Etapa 2 (`rag/`): base de conhecimento, embeddings e vector store - ver
`prompt-2-rag-base-conhecimento.md`.

---

# Etapa 2/3: RAG (base de conhecimento + embeddings + vector store)

## O que foi implementado

- `rag/knowledge_base/*.md` - 5 documentos, um por tipo de consulta cadastrado na API
  (Fisioterapia, Avaliação Postural, RPG, Pilates Clínico, Acupuntura), cada um com Descrição,
  Indicações, Preparo necessário e Contraindicações.
- `rag/embeddings.py` - `gerar_embeddings()`, usando `sentence-transformers`
  (`all-MiniLM-L6-v2`).
- `rag/vector_store.py` - duas coleções Chroma persistentes (`conhecimento_clinico` e
  `contexto_pacientes`, esta última filtrável por `paciente_id`), com `buscar_conhecimento_clinico()`
  e `buscar_contexto_paciente()`. Indexação sempre via `upsert` com ids determinísticos -
  reexecutar não duplica nada.
- `rag/build_index.py` - lê os `.md` estáticos e busca, via as tools da Etapa 1, a anamnese e
  observações de **todos os pacientes reais** cadastrados na API, montando os documentos da
  coleção `contexto_pacientes` a partir disso.

## Ressalva sobre `sentence-transformers` neste ambiente

`sentence-transformers` depende de `torch`. A instalação padrão do `pip` no ambiente onde isto
foi gerado tentou baixar a variante com suporte a GPU (CUDA) - mais de 3GB, sem espaço em disco
disponível no sandbox. Para evitar isso no ambiente de vocês (principalmente se for uma máquina
sem GPU ou com pouco espaço), instale o `torch` para CPU explicitamente **antes** de
`sentence-transformers`:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers chromadb
```
Por isso, a validação de ponta a ponta feita aqui (`agents/test_rag.py`) **substitui**
`embeddings.gerar_embeddings()` por uma função leve baseada em hashing de palavras (só para o
teste, via monkeypatch - `embeddings.py` em si continua implementado com
`sentence-transformers` de verdade). Isso valida o pipeline inteiro (indexação, upsert
idempotente, filtro por paciente, ranqueamento por similaridade) com dados reais da API, mas
**não** valida a qualidade semântica do modelo real (sinônimos, paráfrase). Depois de instalar
`sentence-transformers` de verdade, rode de novo `python -m agents.rag.build_index` e teste
algumas buscas manualmente para confirmar a qualidade na prática.

## Como testar

```bash
# Constrói o índice a partir de dados reais (idempotente - pode rodar de novo a qualquer momento)
python -m agents.rag.build_index

# Teste de ponta a ponta (com o substituto leve de embeddings, ver ressalva acima)
python -m agents.test_rag
```
**Já validado** (rodando contra a API real, com 3 pacientes e 5 tipos de consulta cadastrados):
idempotência (rodar 2x não duplica), busca geral retornando o tipo de consulta certo pra
queries sobre dor lombar e sobre contraindicação de anticoagulante, busca por paciente
retornando o trecho de anamnese/observação certo, e paciente sem dados retornando lista vazia
(não erro).

## Próximos passos
Etapa 3 (`agentes/` + `main.py`): os 4 agentes orquestrados + interface de terminal - ver
`prompt-3-agentes-terminal.md`.

---

# Etapa 3/3: Agentes orquestrados + interface de terminal

## O que foi implementado

- `agentes/planejador.py` - extrai a intenção estruturada do pedido (JSON forçado via o
  parâmetro `format` do Ollama - mais confiável que só pedir "responda em JSON" no prompt) e
  resolve nomes (paciente, profissional, tipo de consulta) para ids reais usando as tools da
  Etapa 1. Em ambiguidade (mais de um paciente parecido) ou nome não encontrado, **não
  adivinha** - preenche `erro` para a interface perguntar de volta ao usuário.
- `agentes/recuperador.py` - busca contexto via as duas coleções da Etapa 2 (RAG), filtrando
  por relevância (`LIMIAR_RELEVANCIA`).
- `agentes/executor.py` - chama as tools de agendamento/consulta. **Decisão de design**: chama
  `agendevy_tools.py` diretamente, sem outra rodada de LLM - na hora em que o executor age, o
  planejador já resolveu intenção e ids de forma determinística, então uma segunda chamada ao
  modelo só adicionaria latência e mais uma chance de erro de um modelo local pequeno, sem
  ganhar nada em troca.
- `agentes/revisor.py` - calcula horários alternativos em caso de conflito 409 (lógica
  determinística em Python, não pede pro LLM "adivinhar" horários livres), checa pendência
  financeira (`checar_saldo_paciente`) e compõe a resposta final via LLM - mas só a
  **composição em linguagem natural** é delegada ao modelo; todos os fatos (houve conflito?
  quais alternativas? há pendência?) são computados antes, em Python.
- `main.py` - REPL de terminal, com `--verbose` mostrando o raciocínio de cada um dos 4
  agentes. Mantém um histórico curto da conversa (últimos `HISTORICO_MAX_TURNOS` pares
  usuário/assistente) e repassa pro planejador, pra resolver pedidos de esclarecimento sem o
  usuário repetir o pedido inteiro (ex: o assistente pergunta "qual paciente?" e o usuário só
  responde o nome). Também imprime uma mensagem de "Carregando resposta..." antes de cada
  chamada ao LLM (modelo local pode demorar alguns segundos), usa cores (`colorama`) para
  distinguir prompt/resposta/erro/modo verbose, e tem comandos especiais que não passam pelo
  LLM: `ajuda` (exemplos de pedidos) e `listar pacientes`/`listar profissionais`/`listar tipos`
  (consultam a API direto, então funcionam mesmo com o Ollama fora do ar - úteis pra descobrir
  nomes reais antes de montar um pedido em linguagem natural).

Nenhuma regra de negócio (conflito de horário, cálculo de saldo) foi reimplementada em
Python - os agentes só leem o que a API do Agendevy já decidiu.

## Nota: o servidor MCP e o `chat_com_tools` não fazem parte do caminho de execução do terminal

Vale deixar explícito porque não é óbvio à primeira vista: o `mcp_server/server.py` (Etapa 1) e
o `llm.chat_com_tools()` (loop genérico de tool-calling, também Etapa 1) **não são usados** pelo
`Agendevy Assistant` (`python -m agents.main`). A decisão de design do executor - chamar
`agendevy_tools.py` direto, sem outra rodada de LLM (ver acima) - significa que nenhum dos 4
agentes precisa do MCP ou do loop de tool-calling genérico para funcionar; o planejador usa
`llm.chat_json()` e o revisor usa `llm.chat_texto()`, ambos primitivos mais simples e mais
previsíveis para um modelo local pequeno do que deixar o próprio modelo escolher qual tool
chamar.

Isso não é uma lacuna a corrigir - é a decisão de arquitetura certa pra este caso (menos
latência, menos uma chance de erro de um modelo local pequeno), e os dois entregáveis continuam
validados isoladamente (`test_llm_loop.py` para o `chat_com_tools`; "mcp dev" para o servidor -
ver Etapa 1 acima). Mas, pra quem for avaliar o trabalho: o MCP e o tool-calling genérico são
demonstrados como capacidades implementadas e testadas desta entrega, não como peças do
pipeline do assistente de terminal. Se quiser ver o MCP em ação, conecte um cliente MCP externo
(Claude Desktop, `mcp dev`, etc.) ao `mcp_server/server.py` - ele expõe as mesmas 10 tools,
independente do `main.py`.

## Ressalva sobre o LLM neste ambiente (mesma limitação das Etapas 1 e 2)

Sem Ollama disponível neste sandbox, não há como validar se um modelo local de verdade
(`llama3.1:8b`) extrai a intenção corretamente a partir de texto livre variado, ou compõe uma
resposta final de boa qualidade. O que foi validado (`agents/test_agentes.py`) é a
**orquestração determinística**: cada agente recebeu um payload de LLM roteirizado (via
injeção de dependência, mesmo padrão usado em `test_llm_loop.py`) simulando uma extração de
intenção plausível, e a partir daí tudo o que aconteceu - resolução de nomes, chamada real à
API, tratamento do 409, cálculo de horário alternativo, checagem de saldo, busca no RAG - é
real, contra o backend rodando de verdade.

**Para validar com o modelo real**, depois de `ollama pull llama3.1:8b`:
```bash
python -m agents.main --verbose
```
e rode os 3 cenários abaixo manualmente, comparando a extração de intenção do modelo real com
o que o teste roteirizado assumiu.

## Os 3 cenários obrigatórios - já validados de ponta a ponta

```bash
python -m agents.test_agentes
```
(Roda duas vezes seguidas sem problema - o cenário 1 cria uma consulta real e a remove no
`finally`, exatamente para o teste ser repetível. Isso pegou um bug real durante o
desenvolvimento: a primeira versão do teste não limpava a consulta criada, e rodar o teste
duas vezes seguidas fazia o cenário "sem conflito" falhar por conflito com a própria execução
anterior.)

1. **Agendamento simples, sem conflito** - "marca uma fisioterapia pra Renata Lima com a
   Camila Souza dia 20/08/2026 às 10h". Cria a consulta de verdade na API e ainda detecta
   (corretamente) que a Renata não tem crédito suficiente para o valor do atendimento.
2. **Agendamento com conflito de horário** - pede o mesmo profissional/horário de uma consulta
   já existente. A API responde 409, o revisor calcula 2 horários livres no mesmo dia
   (`2026-07-10T13:00` e `2026-07-10T15:00`) sem nunca travar o programa.
3. **Pergunta sobre paciente, sem agendamento** - pergunta sobre alergias do paciente João.
   Nenhuma tool de agendamento é chamada; a resposta vem só da anamnese recuperada via RAG
   (a alergia a dipirona registrada na Etapa 1).

## Teste de orquestração do `main.py`

```bash
python -m agents.test_main
```
`test_agentes.py` valida os 4 agentes chamando-os diretamente; este teste valida a "cola" entre
eles dentro de `main.processar_pedido()` - incluindo os parâmetros de injeção
`cliente_planejador`/`cliente_revisor` (mesmo padrão de injeção usado dentro de cada agente) e o
encadeamento do histórico de conversa entre dois turnos. Ao contrário de `test_agentes.py`, não
reconstrói o índice do RAG com embeddings falsos - usa os dados já cadastrados no backend, o
que for, para não exigir uma fixture com nomes fixos nem sobrescrever um índice real.

## Limitação conhecida do `main.py`

A função `processar_pedido()` aceita `cliente_planejador=`/`cliente_revisor=` para injeção (é
o que `test_main.py` usa), mas o REPL real (`main()`) nunca passa um substituto - então rodar
`python -m agents.main` sem o Ollama de pé sempre depende do cliente real. Isso já tem uma
mensagem amigável tratada especificamente (`ConnectionError`, a mesma exceção que o cliente
`ollama` levanta quando não consegue conectar), em vez de cair na mensagem genérica de exceção;
o REPL não quebra feio, mostra o erro e continua aceitando comandos, incluindo "sair".

## Correções pós-teste real (2026-06-21)

Testando com o modelo real (`llama3.1:8b` via Ollama), apareceram dois problemas reais que não
tínhamos pego nos testes com LLM roteirizado: (1) a resposta final mostrava o horário em UTC em
vez de -03:00 (ex: "13:00" em vez de "10:00") - na real, um problema de fuso horário que afetava
o sistema **inteiro**, não só os agentes (inclusive causava consultas "desaparecendo" no
calendário do frontend); e (2) a mensagem de confirmação perguntava "você gostaria de
confirmar?" depois que a consulta **já tinha sido criada** - enganoso, parecia que não tinha
salvado. Os dois foram corrigidos. Detalhe técnico completo no changelog do `CLAUDE.md`
(seção 11) - vale ler antes de tocar em qualquer cálculo de data/hora neste projeto, porque o
padrão certo (e o motivo de não usar `.getHours()`/`datetime.now()` direto) está documentado
lá.

