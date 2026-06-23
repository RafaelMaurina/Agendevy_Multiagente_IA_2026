import { MigrationInterface, QueryRunner } from 'typeorm';

// Adiciona constraint única em (profissionalId, data_hora) para eliminar a
// race condition em que duas requisições simultâneas de criação de consulta
// para o mesmo profissional e horário passam ambas pelo check de conflito
// (feito em query separada, fora de transação) e acabam criando dois
// registros para o mesmo slot.
export class ConsultaProfissionalHorarioUnique1700000000004 implements MigrationInterface {
  name = 'ConsultaProfissionalHorarioUnique1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_consultas_data_hora"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_consulta_profissional_horario"
      ON "consultas" ("profissionalId", "data_hora")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_consulta_profissional_horario"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_consultas_data_hora" ON "consultas" ("data_hora")`);
  }
}
