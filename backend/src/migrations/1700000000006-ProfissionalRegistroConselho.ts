import { MigrationInterface, QueryRunner } from 'typeorm';

// Adiciona o registro em conselho profissional aos profissionais: registro_conselho guarda a
// sigla do conselho (CREFITO, CREA, CRBIO, CRM, etc.) e registro_numero o número da inscrição.
// Ambos nullable - nem todo profissional tem registro, e pode ser preenchido depois.
export class ProfissionalRegistroConselho1700000000006 implements MigrationInterface {
  name = 'ProfissionalRegistroConselho1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "profissionais"
        ADD COLUMN IF NOT EXISTS "registro_conselho" TEXT,
        ADD COLUMN IF NOT EXISTS "registro_numero" TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profissionais" DROP COLUMN IF EXISTS "registro_numero"`);
    await queryRunner.query(`ALTER TABLE "profissionais" DROP COLUMN IF EXISTS "registro_conselho"`);
  }
}
