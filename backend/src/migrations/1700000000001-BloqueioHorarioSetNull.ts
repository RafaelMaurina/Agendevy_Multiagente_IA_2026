import { MigrationInterface, QueryRunner } from 'typeorm';

export class BloqueioHorarioSetNull1700000000001 implements MigrationInterface {
  name = 'BloqueioHorarioSetNull1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing FK (name may vary by DB; use DO block to be safe)
    await queryRunner.query(`
      DO $$
      DECLARE fk_name text;
      BEGIN
        SELECT tc.constraint_name INTO fk_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'bloqueio_horario'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'profissionalId';

        IF fk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE bloqueio_horario DROP CONSTRAINT %I', fk_name);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "bloqueio_horario"
        ADD CONSTRAINT "FK_bloqueio_horario_profissional"
        FOREIGN KEY ("profissionalId") REFERENCES "profissionais"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bloqueio_horario" DROP CONSTRAINT IF EXISTS "FK_bloqueio_horario_profissional"`);
    await queryRunner.query(`
      ALTER TABLE "bloqueio_horario"
        ADD CONSTRAINT "FK_bloqueio_horario_profissional"
        FOREIGN KEY ("profissionalId") REFERENCES "profissionais"("id") ON DELETE CASCADE
    `);
  }
}
