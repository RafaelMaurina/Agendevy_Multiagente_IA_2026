-- Schema de referência do Agendevy.
-- Reflete o estado final das entidades após todas as migrations em src/migrations/.
-- Não é executado pela aplicação (apenas documentação) — a fonte de verdade real
-- são as migrations + as entidades em src/entities/.

CREATE TABLE "pacientes" (
  "id" serial PRIMARY KEY,
  "nome" text NOT NULL,
  "telefone" text,
  "email" text,
  "data_nascimento" date,
  "observacoes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "profissionais" (
  "id" serial PRIMARY KEY,
  "nome" text NOT NULL,
  "especialidade" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "tipos_consulta" (
  "id" serial PRIMARY KEY,
  "nome" text NOT NULL,
  "valor_padrao" numeric(10,2),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "perguntas_anamnese" (
  "id" serial PRIMARY KEY,
  "texto" text NOT NULL,
  "tipo" text NOT NULL DEFAULT 'sim_nao',
  "ativo" boolean NOT NULL DEFAULT true,
  "ordem" int NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "agendamentos" (
  "id" serial PRIMARY KEY,
  "nome" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "profissionalId" int NOT NULL REFERENCES "profissionais"("id") ON DELETE CASCADE
);

CREATE TABLE "consultas" (
  "id" serial PRIMARY KEY,
  "nome_consulta" text,
  "data_hora" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'aberta',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "tipoConsultaId" int REFERENCES "tipos_consulta"("id") ON DELETE SET NULL,
  "pacienteId" int NOT NULL REFERENCES "pacientes"("id") ON DELETE CASCADE,
  "profissionalId" int NOT NULL REFERENCES "profissionais"("id") ON DELETE CASCADE
);

-- Garante (na migration 1700000000004) que um profissional não tenha duas
-- consultas no mesmo horário exato.
CREATE UNIQUE INDEX "uq_consulta_profissional_horario"
  ON "consultas" ("profissionalId", "data_hora");

CREATE TABLE "consultas_agenda" (
  "id" serial PRIMARY KEY,
  "added_at" timestamptz NOT NULL DEFAULT now(),
  "agendaId" int NOT NULL REFERENCES "agendamentos"("id") ON DELETE CASCADE,
  "consultaId" int NOT NULL REFERENCES "consultas"("id") ON DELETE CASCADE
);

CREATE TABLE "comanda_paciente" (
  "id" serial PRIMARY KEY,
  "pacienteId" int NOT NULL REFERENCES "pacientes"("id") ON DELETE CASCADE,
  "consultaId" int REFERENCES "consultas"("id") ON DELETE SET NULL,
  "valor" numeric(10,2) NOT NULL,
  "data_pgto" date,
  "forma_pgto" text,         -- dinheiro | cartao_credito | cartao_debito | pix | credito_sessoes | credito_saldo
  "status_pgto" text,        -- pago | pendente
  "is_credito" boolean NOT NULL DEFAULT false,
  "tipo_credito" text,       -- monetario | sessoes (só quando is_credito = true)
  "sessoes_qty" int,
  "sessoes_consumidas" int,
  "observacao" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Só pode existir um lançamento de PAGAMENTO (is_credito = false) por consulta.
-- Lançamentos de crédito (is_credito = true) não são afetados por esse índice.
CREATE UNIQUE INDEX "uq_comanda_consulta_pagamento"
  ON "comanda_paciente" ("consultaId")
  WHERE "is_credito" = false AND "consultaId" IS NOT NULL;

CREATE TABLE "respostas_anamnese" (
  "id" serial PRIMARY KEY,
  "pacienteId" int NOT NULL REFERENCES "pacientes"("id") ON DELETE CASCADE,
  "perguntaId" int NOT NULL REFERENCES "perguntas_anamnese"("id") ON DELETE CASCADE,
  "resposta" text -- 'sim' | 'nao' | texto livre, depende do tipo da pergunta
);

CREATE TABLE "bloqueio_horario" (
  "id" serial PRIMARY KEY,
  "profissionalId" int REFERENCES "profissionais"("id") ON DELETE SET NULL, -- NULL = bloqueio vale p/ todos
  "inicio" timestamptz NOT NULL,
  "fim" timestamptz NOT NULL,
  "motivo" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
