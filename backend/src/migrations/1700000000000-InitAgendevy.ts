import { MigrationInterface, QueryRunner } from 'typeorm';

// Cria o schema completo do Agendevy.
//
// IMPORTANTE: os nomes de tabela aqui DEVEM bater exatamente com o nome
// configurado em @Entity({ name: '...' }) de cada entidade (todos no plural:
// pacientes, profissionais, consultas, agendamentos, consultas_agenda,
// tipos_consulta, comanda_paciente, perguntas_anamnese, respostas_anamnese,
// bloqueio_horario). Antes desta correção a migration criava tabelas no
// singular (paciente, profissional, consulta, agendamento, consulta_agenda)
// e nem chegava a criar as outras 5 - funcionava em dev só porque
// `synchronize: true` recriava o schema certo por cima, mas em produção
// (synchronize desligado) toda query falhava com "relation does not exist".
export class InitAgendevy1700000000000 implements MigrationInterface {
  name = 'InitAgendevy1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pacientes" (
        "id" SERIAL PRIMARY KEY,
        "nome" text NOT NULL,
        "telefone" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_pacientes_nome" ON "pacientes" ("nome")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "profissionais" (
        "id" SERIAL PRIMARY KEY,
        "nome" text NOT NULL,
        "especialidade" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_profissionais_nome" ON "profissionais" ("nome")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tipos_consulta" (
        "id" SERIAL PRIMARY KEY,
        "nome" text NOT NULL,
        "valor_padrao" numeric(10,2),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "perguntas_anamnese" (
        "id" SERIAL PRIMARY KEY,
        "texto" text NOT NULL,
        "tipo" text NOT NULL DEFAULT 'sim_nao',
        "ativo" boolean NOT NULL DEFAULT true,
        "ordem" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agendamentos" (
        "id" SERIAL PRIMARY KEY,
        "nome" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "profissionalId" int NOT NULL REFERENCES "profissionais"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_agendamentos_nome" ON "agendamentos" ("nome")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "consultas" (
        "id" SERIAL PRIMARY KEY,
        "nome_consulta" text,
        "data_hora" timestamptz NOT NULL,
        "status" text NOT NULL DEFAULT 'aberta',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "tipoConsultaId" int REFERENCES "tipos_consulta"("id") ON DELETE SET NULL,
        "pacienteId" int NOT NULL REFERENCES "pacientes"("id") ON DELETE CASCADE,
        "profissionalId" int NOT NULL REFERENCES "profissionais"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "consultas_agenda" (
        "id" SERIAL PRIMARY KEY,
        "added_at" timestamptz NOT NULL DEFAULT now(),
        "agendaId" int NOT NULL REFERENCES "agendamentos"("id") ON DELETE CASCADE,
        "consultaId" int NOT NULL REFERENCES "consultas"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_consultas_agenda_agendaId" ON "consultas_agenda" ("agendaId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_consultas_agenda_consultaId" ON "consultas_agenda" ("consultaId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "comanda_paciente" (
        "id" SERIAL PRIMARY KEY,
        "pacienteId" int NOT NULL REFERENCES "pacientes"("id") ON DELETE CASCADE,
        "consultaId" int REFERENCES "consultas"("id") ON DELETE SET NULL,
        "valor" numeric(10,2) NOT NULL,
        "data_pgto" date,
        "forma_pgto" text,
        "status_pgto" text,
        "is_credito" boolean NOT NULL DEFAULT false,
        "tipo_credito" text,
        "sessoes_qty" int,
        "sessoes_consumidas" int,
        "observacao" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_comanda_paciente_pacienteId" ON "comanda_paciente" ("pacienteId")`);
    // Garante no banco a regra "só um lançamento de pagamento por consulta" (is_credito=false).
    // Lançamentos de crédito (is_credito=true) e consultas sem lançamento (consultaId NULL) não entram nessa regra.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_comanda_consulta_pagamento"
      ON "comanda_paciente" ("consultaId")
      WHERE "is_credito" = false AND "consultaId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "respostas_anamnese" (
        "id" SERIAL PRIMARY KEY,
        "pacienteId" int NOT NULL REFERENCES "pacientes"("id") ON DELETE CASCADE,
        "perguntaId" int NOT NULL REFERENCES "perguntas_anamnese"("id") ON DELETE CASCADE,
        "resposta" text
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_respostas_anamnese_pacienteId" ON "respostas_anamnese" ("pacienteId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bloqueio_horario" (
        "id" SERIAL PRIMARY KEY,
        "profissionalId" int REFERENCES "profissionais"("id") ON DELETE SET NULL,
        "inicio" timestamptz NOT NULL,
        "fim" timestamptz NOT NULL,
        "motivo" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bloqueio_horario"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "respostas_anamnese"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "comanda_paciente"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "consultas_agenda"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "consultas"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agendamentos"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "perguntas_anamnese"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tipos_consulta"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "profissionais"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pacientes"`);
  }
}
