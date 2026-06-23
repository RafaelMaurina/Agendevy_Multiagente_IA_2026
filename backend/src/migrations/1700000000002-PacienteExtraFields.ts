import { MigrationInterface, QueryRunner } from 'typeorm';

export class PacienteExtraFields1700000000002 implements MigrationInterface {
  name = 'PacienteExtraFields1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pacientes" ADD COLUMN IF NOT EXISTS "email" text`);
    await queryRunner.query(`ALTER TABLE "pacientes" ADD COLUMN IF NOT EXISTS "data_nascimento" date`);
    await queryRunner.query(`ALTER TABLE "pacientes" ADD COLUMN IF NOT EXISTS "observacoes" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pacientes" DROP COLUMN IF EXISTS "observacoes"`);
    await queryRunner.query(`ALTER TABLE "pacientes" DROP COLUMN IF EXISTS "data_nascimento"`);
    await queryRunner.query(`ALTER TABLE "pacientes" DROP COLUMN IF EXISTS "email"`);
  }
}
