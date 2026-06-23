# Como rodar

**Pré-requisitos:** Node.js 18+, Python 3.11+, PostgreSQL, [Ollama](https://ollama.com/download).
Comandos abaixo em **PowerShell** (Windows). Em Linux/macOS, troque `Copy-Item`→`cp`,
`py`→`python3`, e a ativação do venv por `source .venv/bin/activate`.

> **Atenção:** **o serviço do PostgreSQL precisa estar rodando** antes do passo 1 - não basta estar
> instalado. No Windows, confira em "Serviços" (`services.msc`) se o serviço `postgresql-x64-...`
> está como "Em execução"; se você instalou via instalador oficial, ele já fica configurado para
> iniciar com o Windows. Sem isso, `npm run dev`/`migration:run` falham com erro de conexão
> (`ECONNREFUSED` ou `client password must be a string` - ver "Erros comuns" no fim).

## Resumo rápido

| Comando | Instrução |
|---|---|
| `cd backend; Copy-Item .env.example .env` | Cria o `.env` do backend |
| `npm install` | Instala dependências do backend |
| `npm run typeorm -- migration:run` | Cria o schema + dados de demonstração no Postgres |
| `npm run dev` | Inicia o backend (deixe rodando) |
| `cd agents; py -m venv .venv; .venv\Scripts\Activate.ps1` | Cria e ativa o venv Python |
| `pip install torch --index-url https://download.pytorch.org/whl/cpu` | Instala o torch (CPU) |
| `pip install -r requirements.txt` | Instala as dependências dos agentes |
| `ollama pull llama3.1:8b` | Baixa o modelo local |
| `cd ..; python -m agents.rag.build_index` | Constrói o índice do RAG |
| `python -m agents.main --verbose` | Roda o assistente |

## 1. Backend

```powershell
cd backend
Copy-Item .env.example .env
```
Edite o `.env`: troque `DB_PASSWORD=sua_senha_aqui` pela senha real do seu PostgreSQL.

```powershell
npm install
npm run typeorm -- migration:run
npm run dev
```
A migration já cria os dados de demonstração necessários pro assistente (pacientes,
profissionais, tipos de atendimento, anamnese e uma consulta pré-existente - ver
[`README.md`](./README.md#base-de-dados-de-demonstração)), sem precisar de cadastro manual.

Deixe o `npm run dev` rodando. Confirme em outro terminal: `Invoke-RestMethod http://localhost:3000/health`.

## 2. Agentes (Python)

```powershell
cd agents
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
ollama pull llama3.1:8b
```
> `torch` CPU-only primeiro evita baixar ~3GB de dependências de GPU.

**Volte para a raiz** (pasta que contém `backend/`, `frontend_novo/` e `agents/`) e construa o índice:
```powershell
cd ..
python -m agents.rag.build_index
```
> **Atenção:** o índice é um **snapshot** dos dados. Anamnese, observações ou pacientes cadastrados
> **depois** de rodar este comando não aparecem para os agentes até você rodá-lo de novo.
> Sempre que mudar dados de paciente que os agentes precisem enxergar, rode
> `python -m agents.rag.build_index` outra vez.

## 3. Rodar

```powershell
python -m agents.main --verbose
```
Digite `ajuda` a qualquer momento para ver exemplos de pedido e os comandos especiais
(`listar pacientes`/`listar profissionais`/`listar tipos` - mostram quem está cadastrado de
verdade, sem precisar do Ollama). Exemplos de pedido em linguagem natural:
- `marca uma fisioterapia pro Valdivino com a Evllyn T pra sexta às 10h`
- `o que eu preciso saber antes de atender o Valdivino?`

O assistente lembra os últimos turnos da conversa - se ele perguntar de volta (ex: "qual
paciente?", por nome ambíguo), basta responder só a parte que faltava, sem repetir o pedido
inteiro.

Digite `sair` para encerrar.

## Erros comuns

| Erro | Solução |
|---|---|
| `ECONNREFUSED` ao rodar `migration:run`/`npm run dev` | Serviço do PostgreSQL não está rodando - ver aviso no topo deste arquivo. |
| `client password must be a string` | `.env` não existe ou `DB_PASSWORD` está vazio (passo 1). Editou o `.env`? Pare (`Ctrl+C`) e rode `npm run dev` de novo. |
| `Não consegui falar com o modelo local (Ollama)` | Ollama não está rodando - abra o app ou rode `ollama serve`. |
| `No module named 'agents'` | Rode a partir da **raiz** do projeto, não de dentro de `agents/` (`cd ..`). |
| `Activate.ps1 ... execução de scripts desabilitada` | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, confirme com `S`, e tente de novo. |

Detalhes técnicos: `backend/README.md`, `agents/README.md`.
