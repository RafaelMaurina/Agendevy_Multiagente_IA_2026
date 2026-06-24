# Agendevy - Assistente Multiagente de Agenda para Clínicas

Trabalho final da disciplina de Inteligência Artificial: um sistema multiagente baseado em LLMs e RAG, com interface de terminal, construído sobre uma aplicação real de agendamento e gestão financeira para clínicas (pacientes, profissionais, consultas, tipos de atendimento, comanda financeira, anamnese e bloqueios de horário).

> Este README foca em arquitetura e decisões de design.
> Para rodar diretamente a aplicação, acesse direto **[`COMO_RODAR.md`](./COMO_RODAR.md)**.

## Integrantes da equipe

- Rafael de Almeida Maurina (205380).

## Descrição do problema e objetivo da solução

Clínicas pequenas (fisioterapia, psicologia, consultórios em geral) recebem pedidos de agendamento em linguagem natural - por telefone, WhatsApp ou presencialmente - que hoje precisam ser traduzidos manualmente para a interface do sistema: encontrar o paciente certo, checar se o profissional está livre no horário, lembrar de eventuais restrições de saúde do paciente antes do atendimento, e verificar se há pendência financeira. É um trabalho repetitivo, e que interrompe o fluxo de quem está atendendo.

**Objetivo**: um assistente de terminal que entende o pedido em português natural, resolve quem é o paciente/profissional/tipo de atendimento mencionado, executa a ação contra o sistema real de agenda (que já implementa as regras de negócio - conflito de horário, saldo de crédito), e só então responde - citando, quando relevante, informações da anamnese do paciente (alergias, medicação contínua) e do procedimento (preparo, contraindicações) recuperadas de uma base de conhecimento. O sistema **não reimplementa** regra de negócio, cada agente lê o que a API real já decidiu (um erro 409, um saldo insuficiente) e decide como comunicar isso.
É possível solicitar ao agente para registrar uma consulta direto na agenda do profisisonal, por exemplo, mas não trocar o nome desse profissional. 

## Visão geral do repositório

| Diretório | O quê | Stack |
|---|---|---|
| [`backend/`](./backend/README.md) | API REST do Agendevy (regras de negócio, persistência) | Node.js + TypeScript + Express + TypeORM + PostgreSQL |
| [`frontend_novo/`](./frontend_novo/README.md) | Interface web de uso humano direto (sem o assistente) | HTML + CSS + JavaScript puro (sem build, sem framework) |
| [`agents/`](./agents/README.md) | **O trabalho final**: sistema multiagente + RAG + MCP + terminal | Python - Ollama (LLM local), MCP, ChromaDB + sentence-transformers |


## Arquitetura do backend (modelo de dados e regras de negócio)

### Modelo de dados

10 entidades (TypeORM), tabelas sempre no plural:

| Entidade | Tabela | Campos principais | Relações |
|---|---|---|---|
| `Paciente` | `pacientes` | nome*, telefone, email, data_nascimento, observacoes | 1-N `Consulta`, `ComandaPaciente`, `RespostaAnamnese` (CASCADE) |
| `Profissional` | `profissionais` | nome*, especialidade*, registro_conselho, registro_numero | 1-N `Consulta`, `Agendamento` (CASCADE) |
| `TipoConsulta` | `tipos_consulta` | nome*, valor_padrao, duracao_minutos | 1-N `Consulta` (SET NULL) |
| `Consulta` | `consultas` | nome_consulta, data_hora*, horario_fim, status | N-1 `Paciente`/`Profissional` (CASCADE), `TipoConsulta` (SET NULL) |
| `Agendamento` | `agendamentos` | nome* | N-1 `Profissional` (CASCADE); N-N `Consulta` via `ConsultaAgenda` |
| `ComandaPaciente` | `comanda_paciente` | valor*, forma_pgto, status_pgto, is_credito, tipo_credito, sessoes_qty/consumidas | N-1 `Paciente` (CASCADE), `Consulta` (SET NULL, opcional) |
| `PerguntaAnamnese` | `perguntas_anamnese` | texto*, tipo, ativo, ordem | 1-N `RespostaAnamnese` |
| `RespostaAnamnese` | `respostas_anamnese` | resposta | N-1 `Paciente`/`PerguntaAnamnese` (CASCADE) |
| `BloqueioHorario` | `bloqueio_horario` | inicio*, fim*, motivo | N-1 `Profissional` (SET NULL, opcional - `null` = vale para todos) |

`*` = obrigatório. Detalhe completo de cada coluna e índice: `backend/README.md`.

### Regras de negócio 
1. **Conflito de horário**: `horario_fim = data_hora + duracao_minutos do tipo`; sobreposição
   checada contra bloqueios e outras consultas do mesmo profissional -> **HTTP 409**.
2. **Lançamento financeiro automático**: ao criar/editar uma consulta com tipo de valor
   definido, cria/atualiza um `ComandaPaciente` tentando pagar com sessões → saldo monetário →
   senão fica pendente.
3. **Saldo nunca é persistido, só calculado** (`SaldoService`), somando todos os lançamentos do
   paciente
4. **Atomicidade**: qualquer fluxo que lê saldo e grava lançamento roda em transação, evitando
   duas requisições simultâneas debitarem o mesmo crédito duas vezes.
5. **Um pagamento por consulta**, garantido por índice único parcial no banco (créditos sem
   consulta vinculada não entram nessa regra).
6. **Exclusão de paciente/profissional bloqueada (409)** se houver histórico vinculado - as FKs
   são `CASCADE`, então a API impede a exclusão para não apagar histórico em silêncio.
7. **Anamnese usa soft delete** (`ativo=false`) - preserva respostas já registradas.
8. **Inadimplência considera crédito disponível**: só lista quem tem dívida real, não coberta
   por saldo/sessões.

#### Obs
- **Sem autenticação** - é uma decisão de escopo (clínica única, sem mult iusuário), para uso no trabalho final da discplina.
- **`/api/agendas` (entidade `Agendamento`) não é consumido pelo frontend atual** - existe um
  CRUD completo no backend, mas a tela "Agenda" do frontend é só o calendário de `Consulta` +
  `BloqueioHorario`, os agentes também não usam essa entidade. Era de uma versão passada e acabou ficando.

## Arquitetura multiagente

```
texto do usuário
      │
      ▼
┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌────────────┐
│ planejador  │ ──▶│ recuperador  │ ──▶ │  executor  │ ──▶ │  revisor   │ ──▶ resposta final
└─────────────┘     └──────────────┘     └────────────┘     └────────────┘
 extrai intenção      busca contexto       chama a API        valida o resultado
 (LLM, JSON forçado)   (RAG, 2 coleções)    do Agendevy         e compõe a resposta
 resolve nomes→ids                          (sem rodada extra   (LLM só pra prosa;
                                             de LLM)             fatos vêm do Python)
```

Pipeline fixo (não é uma negociação dinâmica entre agentes), onde cada estágio tem uma única responsabilidade e produz uma saída que o próximo consome:

1. **Planejador** (`agents/agentes/planejador.py`): extrai a intenção e as entidades mencionadas
   (paciente, profissional, tipo de atendimento, data/hora) via LLM em modo JSON forçado, e
   resolve cada nome para um id real chamando a API. Em ambiguidade (mais de um paciente
   parecido) ou nome não encontrado, não adivinha - devolve um erro para o usuário responder de volta. Mantém um histórico curto da conversa para resolver exatamente esse tipo de
   pergunta de esclarecimento sem o usuário repetir o pedido inteiro.
2. **Recuperador** (`agents/agentes/recuperador.py`): busca, nas duas coleções do RAG, os
   trechos relevantes para o pedido (anamnese do paciente e/ou conhecimento clínico do
   procedimento).
3. **Executor** (`agents/agentes/executor.py`): chama a tool certa contra a API real (criar
   consulta, listar disponibilidade) com os ids já resolvidos pelo planejador.
4. **Revisor** (`agents/agentes/revisor.py`): calcula horários alternativos em caso de conflito 409, checa pendência financeira, e só então delega ao LLM a composição em linguagem natural da resposta final.

## Tools disponíveis

Todas em `agents/tools/agendevy_tools.py` são funções Python que acessam a API REST real do Agendevy via `httpx`. Tanto o servidor MCP quanto o loop de tool-calling de `llm.py` derivam o schema diretamente destas funções, então a definição da tool nunca pode ficar dessincronizada da implementação.

| Tool | Para quê |
|---|---|
| `listar_pacientes` | Lista todos os pacientes cadastrados |
| `buscar_paciente_por_nome` | Busca paciente por nome (parcial, case-insensitive) |
| `buscar_paciente_por_id` | Dados completos de um paciente já com id conhecido |
| `listar_profissionais` | Lista todos os profissionais |
| `listar_tipos_consulta` | Lista tipos de atendimento (nome, valor, duração) |
| `listar_consultas` | Lista consultas, com filtro opcional por profissional/paciente |
| `criar_consulta` | Cria uma consulta (a API decide conflito 409, fim calculado pela duração do tipo) |
| `listar_bloqueios` | Lista bloqueios de horário (feriado, folga), opcionalmente por profissional |
| `checar_saldo_paciente` | Saldo de crédito do paciente (monetário e sessões), sempre calculado pela API |
| `buscar_anamnese_paciente` | Anamnese completa do paciente (pergunta + resposta, ou `null`) |

Nenhuma tool lança exceção para erros HTTP esperados (400/404/409), todas devolvem um dict
`{"erro": true, "status", "mensagem"}` para a camada de agente decidir o que fazer, em vez de o
programa quebrar.

## MCP (Model Context Protocol)

`agents/mcp_server/server.py` expõe as 10 tools acima como tools MCP, via `FastMCP`. Cada docstring foi escrita deliberadamente específica - é o texto que um LLM do lado cliente lê para
decidir quando chamar cada tool. Validado com a ferramenta de inspeção do próprio SDK MCP
(`mcp dev mcp_server/server.py`), que lista corretamente as 10 tools com seus schemas.

**Nota sobre como o MCP**: os 4 agentes do terminal (`agents/main.py`) não passam pelo servidor MCP em tempo de execução, o executor chama `agendevy_tools.py` diretamente (uma rodada de LLM/MCP extra só pra escolher uma tool que já está implícita no resultado do planejador adicionaria latência
sem ganho). O MCP existe como uma camada de acesso padronizado e independente às mesmas tools, pensada para qualquer cliente MCP externo, sendo testada e reutilizável, mas não é uma peça do caminho de execução do assistente de terminal. Pelo mesmo motivo, `agents/llm.py` implementa
`chat_com_tools()` (loop genérico de tool-calling sobre o Ollama, validado isoladamente em `agents/test_llm_loop.py`) como o primitivo que um cliente MCP-sobre-Ollama usaria - também não chamado pelos 4 agentes, que preferem os modos mais simples e previsíveis `chat_json`/`chat_texto`
(ver `agents/README.md` para o detalhe completo desta decisão).

## RAG (Retrieval-Augmented Generation)

Duas coleções **ChromaDB** propositalmente separadas (`agents/rag/vector_store.py`), porque têm
natureza e cadência de atualização diferentes:

- **`conhecimento_clinico`** - base estática (versionada no repositório), um documento por tipo
  de atendimento + 2 documentos de política geral da clínica (agendamento, pagamento/crédito).
  Resultados filtrados por um limiar de similaridade mais exigente (0.40).
- **`contexto_pacientes`** - dinâmica, construída a partir de dados **reais** da API (anamnese respondida + observações de cada paciente). 
Limiar mais permissivo (0.30): informação clínica é a mais crítica de errar por omissão, então prefere-se mostrar um trecho de relevância duvidosa a esconder uma alergia. Para perguntas genéricas ("o que preciso saber antes de atender?"), o recuperador ignora o ranqueamento por similaridade e traz **toda** a anamnese do paciente - uma busca filtrada por palavra-chave deixaria de fora informação igualmente
  relevante (medicação contínua, peso, altura) que não compartilha vocabulário com a pergunta.

Indexação sempre via `upsert` com ids determinísticos -> reconstruir o índice (`python -m agents.rag.build_index`) nunca duplica documentos, só atualiza.

## Base de conhecimento

- **`agents/rag/knowledge_base/*.md`** (estática, 7 arquivos):
-> 5 documentos de procedimento  (Fisioterapia - Sessão, Avaliação Postural, RPG, Pilates Clínico, Acupuntura), cada um com Descrição/Indicações/Preparo/Contraindicações, espelhando exatamente os 5 tipos de atendimento cadastrados via migration (ver "Base de dados de demonstração" abaixo) 
-> 2 documentos de política geral da clínica (agendamento, pagamento/créditos).
- **Anamnese e observações reais dos pacientes** (dinâmica, via API) 
-> perguntas/respostas de anamnese e o campo `observacoes` de cada paciente, buscados ao vivo na API do Agendevy no momento de `build_index` (é por isso que o índice é um *snapshot*: dados cadastrados depois não aparecem até reconstruir).

## Embeddings e armazenamento vetorial

`sentence-transformers` com o modelo **`all-MiniLM-L6-v2`** (`agents/rag/embeddings.py`): roda
100% local e gratuito, sem depender de nenhuma API externa de embeddings nem do Ollama estar de
pé só para isso. Vetores normalizados (norma L2 = 1) e coleções Chroma com `hnsw:space=cosine`,
para que a distância de cosseno do Chroma corresponda diretamente a `1 - similaridade`. O Chroma roda em modo `PersistentClient` (`agents/rag/data/`, fora do controle de versão) com `embedding_function=None`: os embeddings são calculados explicitamente por este módulo, nunca pelo Chroma, para nunca baixar um modelo de embedding próprio fora do nosso controle.

## Modelo local e forma de execução

**Ollama** servindo **`llama3.1:8b`**: escolhido por suportar *tool-calling*/JSON estruturado
nativamente (essencial para o planejador) e rodar em hardware de consumo (CPU ou GPU modesta),
sem depender de API paga. 
`agents/llm.py` tem três modos de chamada sobre o cliente `ollama`: `chat_json` (planejador - extração com schema forçado via parâmetro `format` do Ollama), `chat_texto` (revisor - composição livre de texto) e `chat_com_tools` (loop genérico de tool-calling). 
Execução: `ollama pull llama3.1:8b`, servidor em `http://localhost:11434` (configurável via `OLLAMA_HOST`/`OLLAMA_MODEL`, ver `agents/config.py`).

## Dependências do projeto

- **Backend** (`backend/package.json`): `express`, `typeorm` + `pg` (PostgreSQL), `cors`,
  `express-rate-limit`; dev: `typescript`, `ts-node`, `nodemon`, `tsconfig-paths`.
- **Agentes** (`agents/requirements.txt`): `httpx` (cliente HTTP das tools), `ollama` (cliente
  do modelo local), `mcp[cli]` (servidor MCP), `colorama` (formatação do terminal); para o RAG:
  `chromadb` e `sentence-transformers` (que depende de `torch` -> ver nota de instalação CPU-only
  no `COMO_RODAR.md`).

## Instalação e execução

Passo a passo completo, com erros comuns e solução: **[`COMO_RODAR.md`](./COMO_RODAR.md)**.
Resumo:

```bash
# 1. Backend (precisa do PostgreSQL rodando - ver aviso no COMO_RODAR.md)
cd backend && npm install && npm run typeorm -- migration:run && npm run dev

# 2. Agentes (em outro terminal, a partir da raiz do repositório)
cd agents && pip install -r requirements.txt && ollama pull llama3.1:8b
cd .. && python -m agents.rag.build_index
python -m agents.main --verbose
```

### Base de dados de demonstração

As migrations `1700000000007-SeedCadastrosDemonstracao` e
`1700000000008-SeedAnamneseConsultaDemonstracao` (`backend/src/migrations/`) populam, junto com
o schema, os dados mínimos para os 3 cenários abaixo funcionarem **assim que o backend subir**,
sem cadastro manual: profissional (Evllyn T - Fisioterapeuta), os
5 tipos de atendimento que espelham a base de conhecimento, 3 pacientes (Valdivino - com
anamnese de alergia/medicação; Marga Almeida - sem crédito cadastrado, para o aviso financeiro;
Daniels Djalma Neto Jr - usado no cenário de conflito) e uma consulta já existente (Valdivino com Evllyn T,
10/07/2026 às 14h) que o cenário 2 usa para gerar o conflito 409.

## Exemplos de uso pelo terminal

Capturados rodando `python -m agents.main --verbose` de verdade (Ollama + backend reais, dados
da migration de demonstração acima):

**1 - Agendamento sem conflito, com aviso financeiro automático:**
```
> marca uma fisioterapia pra Marga Almeida com a Evllyn T dia 20/08/2026 às 10h
Carregando resposta...
Confirmado: consulta de Fisioterapia - Sessão para o paciente Marga Almeida com o profissional
Evllyn T salva para 2026-08-20T10:00:00-03:00.

É importante notar que o atendimento não tem crédito suficiente para cobrir o valor e o
lançamento financeiro permanecerá pendente até o pagamento.

Além disso, foi identificada a necessidade de preparo necessário e contraindicações relevantes.
Marga Almeida deveria trazer exames de imagem recentes (ressonância ou raio-x), se houver, e não
tem contraindicações atuais para realizar a fisioterapia.

Precisa de mais alguma coisa?
```

**2 - Agendamento com conflito de horário (a consulta de demonstração já ocupa o slot):**
```
> agenda uma fisioterapia pro Daniels Djalma Neto Jr com a Evllyn T no dia 10/07/2026 às 14h
Carregando resposta...
Aguardo sua confirmação para marcar uma das alternativas disponíveis no mesmo dia: 13h ou 15h.
O paciente precisa trazer exames de imagem recentes, se houver, e informar sobre qualquer
processo infeccioso agudo ou fratura não consolidada.
```

**3 - Pergunta sobre paciente, sem agendamento (resposta vem só da anamnese via RAG):**
```
> o que eu preciso saber antes de atender o Valdivino?
Carregando resposta...
Nada relevante foi encontrado em relação à dor lombar crônica há 2 anos do paciente Valdivino.
No entanto, informamos que ele possui alergia a dipirona. Nenhuma medicação contínua é
utilizada por ele. Precisa de mais alguma coisa?
```

Digite `ajuda` no terminal a qualquer momento para ver esses exemplos de novo, ou `listar
pacientes`/`listar profissionais`/`listar tipos` para consultar os dados cadastrados sem
precisar do Ollama.

## Reflexão crítica

**O que mais deu certo:** dividir o pipeline em 4 agentes de responsabilidade única (planejador,
recuperador, executor, revisor) tornou cada parte testável isoladamente, e principalmente
manteve toda decisão objetiva em Python determinístico, nunca delegada ao LLM. Isso significou que, mesmo com um modelo local pequeno (`llama3.1:8b`), o sistema não alucina inventando um id ou um saldo, protegendo também as regras de negócio.
Separar o RAG em duas coleções com limiares de relevância diferentes (estática vs. dinâmica) tambémfoi positivo, pois resolveu um problema real de trechos de procedimento irrelevantes aparecendo em perguntas sobre paciente.

**O que foi mais difícil:** calibrar os limiares de similaridade do RAG exigiu iteração - um limiar
único de 0.2 deixava passar ruído, e ajustar para dois limiares (0.30 para anamnese, 0.40 para
conhecimento clínico) só ficou claro depois de ver o problema na prática. Fuso horário foi outra
fonte recorrente de bugs: qualquer acesso direto a `.getHours()`/`.getDate()`/`datetime.now()`
sem fixar -03:00 explicitamente lia o fuso do SO da máquina de quem executava o processo, isso já causou consultas desaparecendo do calendário e horários errados em mensagens de confirmação, em pontos diferentes do sistema (backend, frontend e agentes). E só testando com o modelo real apareceram os bugs mais sutis: horário em UTC numa resposta, mensagem de confirmação que perguntava "você confirma?" depois que a consulta já tinha sido salva, entre alguns outros conflitos.

**O que faria diferente hoje:** testar com o modelo real mais cedo no processo, em vez de deixar isso para o final.
Também decidir, desde o início da arquitetura, se o MCP seria de fato parte do caminho de execução do assistente ou um artefato isolado para fins de avaliação técnica, sendo decidido só pelo final do prazo a maneira conduzida.

## Documentação complementar

- **[`COMO_RODAR.md`](./COMO_RODAR.md)** - passo a passo completo de instalação/execução e
  tabela de erros comuns. **Use este arquivo para efetivamente rodar o projeto.**

- **[`backend/README.md`](./backend/README.md)** - modelo de dados, regras de negócio e
  referência completa da API REST.
- **[`frontend_novo/README.md`](./frontend_novo/README.md)** - páginas, estrutura de arquivos e
  convenções da interface web.
- **[`agents/README.md`](./agents/README.md)** - documentação técnica completa da camada de
  agentes, organizada pelas 3 etapas de implementação (tools+MCP, RAG, agentes+terminal) -
  detalhe de cada decisão de design e das validações automatizadas.

## Diagrama entidade-relacionamento

Ver [`backend/docs/ER.png`](./backend/docs/ER.png).
