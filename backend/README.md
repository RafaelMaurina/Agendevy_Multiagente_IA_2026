# Agendevy API (Node + TypeScript + Express + TypeORM)

API REST de agendamento para clínicas - gestão de pacientes, profissionais,
agendas (calendário), consultas, tipos de atendimento, comanda financeira
(pagamentos e créditos), anamnese e bloqueios de horário.

> Versão: **v2**. Este backend acompanha o frontend estático em `../frontend_novo`.

## Sumário
- [Stack](#stack)
- [Modelo de dados](#modelo-de-dados)
- [Regras de negócio importantes](#regras-de-negócio-importantes)
- [Setup](#setup)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Referência da API](#referência-da-api)
- [TypeORM / Migrations](#typeorm--migrations)
- [Observações de modelagem](#observações-de-modelagem)

## Stack
- **Runtime**: Node.js + TypeScript (compilado com `tsc`, executado em dev com `ts-node`/`nodemon`)
- **Framework HTTP**: Express 4
- **ORM**: TypeORM 0.3 (decorators, `synchronize` em dev, migrations em produção)
- **Banco**: PostgreSQL (`pg`)
- **Outros**: `cors`, `dotenv`, `express-rate-limit`, alias de import via `tsconfig-paths` (`@config`, `@entities`, `@controllers`, `@routes`, `@middlewares`)

## Modelo de dados

| Entidade | Tabela | Descrição |
|---|---|---|
| `Paciente` | `pacientes` | Cadastro de pacientes |
| `Profissional` | `profissionais` | Cadastro de profissionais |
| `TipoConsulta` | `tipos_consulta` | Tipo de atendimento: nome, valor padrão, duração em minutos |
| `Consulta` | `consultas` | Um atendimento agendado (paciente + profissional + horário) |
| `Agendamento` | `agendamentos` | Uma "agenda" (calendário) pertencente a um profissional |
| `ConsultaAgenda` | `consultas_agenda` | Vínculo N–N entre `Agendamento` e `Consulta` |
| `ComandaPaciente` | `comanda_paciente` | Lançamento financeiro: pagamento de consulta OU crédito (saldo/sessões) de um paciente |
| `PerguntaAnamnese` | `perguntas_anamnese` | Pergunta de um formulário de anamnese (sim/não ou texto livre) |
| `RespostaAnamnese` | `respostas_anamnese` | Resposta de um paciente a uma pergunta de anamnese |
| `BloqueioHorario` | `bloqueio_horario` | Intervalo de horário indisponível (de um profissional específico ou geral) |

### Relacionamentos e cascatas
- `Profissional` 1-N `Consulta` / `Agendamento` - **`ON DELETE CASCADE`** (por isso excluir um
  profissional com consultas é bloqueado na aplicação, ver abaixo).
- `Paciente` 1-N `Consulta` / `ComandaPaciente` / `RespostaAnamnese` - **`ON DELETE CASCADE`**
  (mesmo motivo: exclusão de paciente é bloqueada se houver histórico).
- `Agendamento` N-N `Consulta` via `ConsultaAgenda` - vínculo simples, sem metadados extras.
  Toda consulta criada/editada para um profissional é automaticamente sincronizada com
  **todas** as agendas desse profissional (`syncConsultaComAgendasDoProfissional` em
  `ConsultaController`).
- `Consulta` 1-1 lançamento de **pagamento** em `ComandaPaciente` - reforçado por um índice
  único parcial no banco (`uq_comanda_consulta_pagamento`, válido apenas quando
  `is_credito = false AND consultaId IS NOT NULL`). Lançamentos de crédito não têm consulta
  vinculada e não são afetados por esse índice.
- `BloqueioHorario.profissional` é **opcional** (`SET NULL`) - um bloqueio sem profissional
  vale para todos os profissionais (ex: feriado da clínica).
- `ComandaPaciente.consulta` é **`SET NULL`** - excluir uma consulta preserva o lançamento
  financeiro, apenas desvincula a referência.
- `Consulta.tipo_consulta` é **`SET NULL`** - excluir um tipo de consulta não apaga as
  consultas já criadas com ele.

Ver `docs/ER.png` para o diagrama visual e `docs/dll.sql` para o schema de referência, apenas documentação.

## Regras de negócio importantes

Estas regras vivem no código (controllers/services), não apenas no banco - leia com atenção
antes de alterar fluxos de consulta ou financeiro.

1. **Sem conflito de horário.** Ao criar/editar uma `Consulta`, o backend calcula
   `horario_fim = data_hora + tipo_consulta.duracao_minutos` (fallback de 30 min se não houver
   tipo) e verifica sobreposição de intervalo contra: (a) `BloqueioHorario` do profissional ou
   geral, e (b) outras consultas do mesmo profissional. Sobreposição: `A.inicio < B.fim AND
   B.inicio < A.fim`. Em conflito, retorna **HTTP 409**.
   Além da verificação em código, existe um **índice único** `uq_consulta_profissional_horario`
   em `(profissionalId, data_hora)` no banco como última linha de defesa contra race condition
   (duas requisições simultâneas criando consulta no mesmo slot).
2. **Lançamento financeiro automático.** Ao criar (ou trocar o tipo de) uma consulta com
   `tipo_consulta.valor_padrao` definido, um lançamento (`ComandaPaciente`, `is_credito=false`)
   é criado automaticamente (`criarLancamentoParaConsulta`), tentando pagar com crédito
   disponível do paciente, na seguinte ordem de prioridade:
   1. **Sessões pagas** disponíveis (`forma_pgto='credito_sessoes'`, consome 1 sessão)
   2. **Saldo monetário** disponível (`forma_pgto='credito_saldo'`)
   3. Caso contrário, fica **pendente** (sem forma de pagamento, aguardando pagamento manual).
3. **Saldo de crédito é calculado, nunca armazenado.** `SaldoService.calcularSaldo()` é a
   **fonte única de verdade**: soma créditos lançados manualmente (`is_credito=true`) e subtrai
   o que já foi consumido. Sempre recebe um `EntityManager` (não o repositório global) para
   poder ser chamado dentro de uma transação ativa.
4. **Atomicidade no débito de crédito.** Toda operação que lê saldo e grava um lançamento
   (`ComandaController.create/update`, `criarLancamentoParaConsulta`) roda dentro de uma
   transação (`queryRunner`) para impedir que duas requisições concorrentes debitem o mesmo
   saldo duas vezes.
5. **Um pagamento por consulta.** Reforçado na aplicação (`ComandaController.create` verifica
   antes de inserir) e no banco (índice único parcial). Tentar criar um segundo lançamento de
   pagamento para a mesma consulta retorna **HTTP 409** com o `id` do lançamento existente.
6. **Exclusão protegida.** `Paciente` e `Profissional` **não podem ser excluídos** se já
   possuírem consultas (ou, no caso de paciente, lançamentos financeiros) - retorna **HTTP 409**
   com a contagem de registros vinculados. Isso existe porque as FKs reais são
   `ON DELETE CASCADE`; sem esse bloqueio, excluir um cadastro apagaria silenciosamente todo o
   histórico clínico/financeiro relacionado.
7. **Perguntas de anamnese usam soft delete.** `DELETE /anamnese/perguntas/:id` apenas marca
   `ativo=false` - preserva as respostas históricas já registradas.
8. **Sincronização consulta ↔ agenda.** `POST /consultas/sync-agendas` é um endpoint utilitário
   de manutenção: percorre todas as consultas e garante que cada uma esteja vinculada a todas
   as agendas do seu profissional (útil após criar uma nova agenda para um profissional que já
   tinha consultas).

## Setup

1. Crie `.env` com base em `.env.example` (**não** commite o `.env` real).
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Rode as migrations (cria o schema no Postgres):
   ```bash
   npm run typeorm -- migration:run
   ```
4. Execute em desenvolvimento (hot reload via `nodemon`):
   ```bash
   npm run dev
   ```
5. Build de produção:
   ```bash
   npm run build
   npm start
   ```

`GET /health` retorna `{ status: 'ok', uptime }` e pode ser usado como healthcheck.

## Variáveis de ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `NODE_ENV` | `development` ou `production`. Controla `synchronize` do TypeORM e se o stack trace de erro é exposto na resposta HTTP. | - |
| `PORT` | Porta HTTP do servidor Express. | `3000` |
| `DB_HOST` | Host do PostgreSQL. | - |
| `DB_PORT` | Porta do PostgreSQL. | `5432` |
| `DB_USER` | Usuário do PostgreSQL. | - |
| `DB_PASSWORD` | Senha do PostgreSQL. | - |
| `DB_NAME` | Nome do banco. | - |
| `CORS_ORIGIN` | Origem permitida pelo CORS (URL do frontend). | `http://localhost:3001` |

## Estrutura de pastas

```
backend/
├── app.ts                       # Configuração do Express (CORS, rate limit, /health, rotas, errorHandler)
├── server.ts                    # Ponto de entrada: conecta no banco e inicia o servidor HTTP
├── tsconfig.json                # Paths (@config, @entities, @controllers, @routes, @middlewares)
├── nodemon.json                 # Hot reload em dev
├── docs/
│   ├── ER.png                   # Diagrama entidade-relacionamento
│   ├── dll.sql                  # Schema de referência (documentação, não executado)
│   └── agenda_postman.json      # Coleção Postman (cobre só o CRUD básico - ver nota abaixo)
└── src/
    ├── config/
    │   └── data-source.ts       # DataSource (singleton) do TypeORM
    ├── entities/                # 10 entidades (ver tabela acima)
    ├── controllers/             # 1 controller por recurso, métodos estáticos
    ├── routes/                  # 1 router por recurso + index.ts agregador
    ├── middlewares/
    │   ├── asyncHandler.ts      # Encapsula handlers async -> next(err) em rejeições
    │   └── errorHandler.ts      # Handler de erro global do Express
    ├── services/
    │   └── SaldoService.ts      # Cálculo de saldo de crédito (monetário/sessões) de um paciente
    └── migrations/              # 9 migrations, em ordem cronológica (ver seção TypeORM)
```

> **Nota sobre `docs/agenda_postman.json`:** a coleção cobre apenas Pacientes, Profissionais,
> Consultas e Agendas (CRUD básico). Os recursos adicionados depois - `tipos-consulta`,
> `comanda`, `anamnese`, `bloqueios` - **não** estão na coleção; use a referência da API abaixo
> para esses.

## Referência da API

Base path: `/api` (definido em `app.ts` e `src/routes/index.ts`). Rate limit global: **200
requisições/minuto por IP** em todo o prefixo `/api`.

Convenções de resposta:
- Sucesso de criação → `201` com o objeto criado.
- Sucesso de leitura/atualização → `200` com o objeto.
- Sucesso de remoção → `204` sem corpo.
- Erro de validação → `400` `{ message }`.
- Não encontrado → `404` `{ message }`.
- Conflito (horário, pagamento duplicado, exclusão bloqueada) → `409` `{ message, existing_id? }`.

### Pacientes - `/api/pacientes`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista todos |
| GET | `/:id` | Busca por id |
| POST | `/` | Cria. Body: `{ nome*, telefone, email, data_nascimento, observacoes }` |
| PUT | `/:id` | Atualiza campos parciais |
| DELETE | `/:id` | Remove - **bloqueado (409)** se houver consultas ou lançamentos financeiros |

### Profissionais - `/api/profissionais`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista todos |
| GET | `/:id` | Busca por id |
| POST | `/` | Cria. Body: `{ nome*, especialidade }` |
| PUT | `/:id` | Atualiza |
| DELETE | `/:id` | Remove - **bloqueado (409)** se houver consultas vinculadas |

### Tipos de consulta - `/api/tipos-consulta`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista todos (ordenado por nome) |
| GET | `/:id` | Busca por id |
| POST | `/` | Cria. Body: `{ nome*, valor_padrao?, duracao_minutos? (padrão 30) }` |
| PUT | `/:id` | Atualiza |
| DELETE | `/:id` | Remove |

### Consultas - `/api/consultas`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista todas, com `paciente`, `profissional`, `tipo_consulta`, ordenado por `data_hora` |
| GET | `/:id` | Busca por id |
| POST | `/` | Cria. Body: `{ paciente_id*, profissional_id*, data_hora*, tipo_consulta_id?, nome_consulta? }` - **`status` não é aceito aqui**, toda consulta nasce com `status: "aberta"` (mude depois via `PUT`). Calcula `horario_fim`, valida conflito de horário, sincroniza com agendas do profissional e cria lançamento financeiro automático se houver `valor_padrao` |
| PUT | `/:id` | Atualiza campos parciais (mesma validação de conflito ao mudar `data_hora`/`profissional_id`) |
| DELETE | `/:id` | Remove. Desvincula de `ConsultaAgenda` e `SET NULL` no lançamento financeiro associado antes de excluir |
| POST | `/sync-agendas` | Manutenção: garante vínculo de toda consulta com todas as agendas do seu profissional. Retorna `{ consultas_processadas, vinculos_criados }` |

`status` válido: `aberta` \| `agendada` \| `realizada` \| `cancelada`.

### Agendas (calendários) - `/api/agendas`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista todas, com `profissional` e `consultas` vinculadas |
| GET | `/:id` | Busca por id |
| POST | `/` | Cria. Body: `{ nome*, profissional* (id ou objeto) }` |
| PUT | `/:id` | Atualiza `nome` |
| DELETE | `/:id` | Remove |
| POST | `/:id/consultas` | Vincula uma consulta existente à agenda. Body: `{ consulta_id* }`. `409` se já vinculada |
| GET | `/:id/consultas` | Lista os vínculos `ConsultaAgenda` da agenda |
| DELETE | `/:id/consultas/:consultaId` | Remove o vínculo (não exclui a consulta) |

### Comanda financeira - `/api/comanda`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista todos os lançamentos |
| GET | `/:id` | Busca por id |
| GET | `/consulta/:consultaId` | Lançamento de **pagamento** (`is_credito=false`) de uma consulta |
| GET | `/paciente/:pacienteId` | Lançamentos de um paciente (mais recentes primeiro) |
| GET | `/paciente/:pacienteId/saldo` | Saldo calculado: `{ saldo_monetario, sessoes_pagas, sessoes_consumidas, sessoes_disponiveis }` |
| GET | `/inadimplentes` | Pacientes com saldo devedor real (após abater crédito disponível) - ver regra 6 acima |
| POST | `/` | Cria lançamento de pagamento **ou** de crédito. Ver corpo abaixo |
| PUT | `/:id` | Atualiza um lançamento (recalcula `status_pgto` se `forma_pgto` mudar) |
| DELETE | `/:id` | Remove |

Body de `POST /comanda`:
```jsonc
{
  "paciente_id": 1,            // obrigatório
  "valor": 150.00,             // obrigatório, >= 0
  "consulta_id": 10,           // opcional - só para lançamento de PAGAMENTO
  "is_credito": false,         // true = crédito manual (sem consulta), false = pagamento
  "tipo_credito": "monetario", // 'monetario' | 'sessoes' - só relevante se is_credito=true
  "sessoes_qty": 10,           // qtd de sessões - só se tipo_credito='sessoes'
  "forma_pgto": "pix",         // 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix' | 'credito_sessoes' | 'credito_saldo'
  "data_pgto": "2026-06-20",   // YYYY-MM-DD
  "observacao": "..."
}
```
Se `forma_pgto` for `credito_saldo` ou `credito_sessoes`, o backend verifica o saldo disponível
do paciente (dentro da mesma transação) e só confirma o pagamento (`status_pgto='pago'`) se
houver crédito suficiente; senão, devolve para `pendente` e zera `forma_pgto`.

### Anamnese - `/api/anamnese`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/perguntas` | Lista perguntas ativas (ordenadas por `ordem`) |
| POST | `/perguntas` | Cria. Body: `{ texto*, tipo? ('sim_nao'\|'texto', padrão 'sim_nao'), ordem? }` |
| PUT | `/perguntas/:id` | Atualiza (`texto`, `tipo`, `ativo`, `ordem`) |
| DELETE | `/perguntas/:id` | **Soft delete** - apenas marca `ativo=false` |
| GET | `/paciente/:pacienteId` | Retorna todas as perguntas ativas + resposta do paciente (ou `null`) para cada |
| POST | `/paciente/:pacienteId` | Salva respostas em lote. Body: `[{ pergunta_id, resposta }]` |

### Bloqueios de horário - `/api/bloqueios`
| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista todos, ordenado por `inicio` |
| POST | `/` | Cria. Body: `{ inicio*, fim*, motivo?, profissional_id? }`. Sem `profissional_id` o bloqueio vale para todos. `fim` deve ser > `inicio` |
| DELETE | `/:id` | Remove |

## TypeORM / Migrations

Migrations existentes (em ordem cronológica, prefixo de timestamp):

1. `InitAgendevy` - cria o schema completo (todas as 10 tabelas, no plural, batendo com `@Entity({ name })`).
2. `BloqueioHorarioSetNull` - corrige a FK de `bloqueio_horario.profissionalId` para `ON DELETE SET NULL`.
3. `PacienteExtraFields` - adiciona `email`, `data_nascimento`, `observacoes` em `pacientes`.
4. `ComandaPacienteConsultaSetNull` - corrige a FK de `comanda_paciente.consultaId` para `ON DELETE SET NULL` (necessário para poder excluir uma consulta com pagamento vinculado).
5. `ConsultaProfissionalHorarioUnique` - cria índice único `(profissionalId, data_hora)` para eliminar race condition de duplo agendamento simultâneo.
6. `TipoConsultaDuracaoMinutosConsultaHorarioFim` - adiciona `duracao_minutos` em `tipos_consulta` e `horario_fim` em `consultas`.
7. `ProfissionalRegistroConselho` - adiciona `registro_conselho`/`registro_numero` (opcionais) em `profissionais`.
8. `SeedCadastrosDemonstracao` - popula profissionais, tipos de atendimento (espelhando `agents/rag/knowledge_base/`), pacientes e perguntas de anamnese de demonstração, usados pelo Agendevy Assistant (`agents/`) e por `agents/test_agentes.py`.
9. `SeedAnamneseConsultaDemonstracao` - popula respostas de anamnese e uma consulta já existente (dependem dos ids criados pela migration anterior, resolvidos por nome/texto via `SELECT`) - ver `README.md` da raiz, seção "Base de dados de demonstração".

Ao modificar campos de entidades, **gere uma nova migration** em vez de editar as existentes:

```bash
npx typeorm-ts-node-commonjs migration:generate src/migrations/NomeDaMudanca -d src/config/data-source.ts
```

Outros comandos úteis:
```bash
npm run typeorm -- migration:run        # aplica migrations pendentes
npm run typeorm -- migration:revert     # desfaz a última migration aplicada
npm run typeorm -- migration:show       # lista status das migrations
```

## Observações de modelagem

- Os nomes das tabelas no banco são sempre o **plural** do nome da entidade (`pacientes`,
  `profissionais`, `consultas`, `agendamentos`, `consultas_agenda`, `tipos_consulta`,
  `comanda_paciente`, `perguntas_anamnese`, `respostas_anamnese`, `bloqueio_horario`) - isso
  precisa bater exatamente com `@Entity({ name: '...' })` de cada entidade e com o que as
  migrations criam.
- `synchronize: process.env.NODE_ENV !== 'production'` mantém o schema sincronizado
  automaticamente em desenvolvimento. Em produção `synchronize` fica desligado, então as
  migrations são a única fonte do schema - rode `migration:run` **antes** de subir o servidor
  em produção.
- A regra "uma consulta tem no máximo um lançamento de pagamento" é reforçada tanto na
  aplicação (`ComandaController.create`) quanto no banco (índice único parcial
  `uq_comanda_consulta_pagamento`), para sobreviver a requisições concorrentes.
- O débito de crédito/sessões (`SaldoService` + `aplicarFormaPagamento`) sempre roda dentro de
  uma transação para evitar condição de corrida ao consumir o mesmo saldo duas vezes.
- O alias de import `@entities/...`, `@controllers/...` etc. (configurado em `tsconfig.json`)
  exige `ts-node -r tsconfig-paths/register` para funcionar fora do build (já configurado em
  `nodemon.json` e no script `typeorm` do `package.json`).
