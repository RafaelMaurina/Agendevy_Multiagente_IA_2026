import { MigrationInterface, QueryRunner } from 'typeorm';

// Corrige a FK comanda_paciente.consultaId, que pode ter ficado sem
// "ON DELETE SET NULL" no banco real (o TypeORM synchronize:true não
// reescreve automaticamente o onDelete de uma constraint já existente).
// Sem essa correção, excluir uma consulta que tenha algum lançamento
// financeiro vinculado falha com "violates foreign key constraint".
export class ComandaPacienteConsultaSetNull1700000000003 implements MigrationInterface {
  name = 'ComandaPacienteConsultaSetNull1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE fk_name text;
      BEGIN
        SELECT tc.constraint_name INTO fk_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'comanda_paciente'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'consultaId';

        IF fk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE comanda_paciente DROP CONSTRAINT %I', fk_name);
        END IF;
      END $$;
    `);

    // Garante que a coluna aceita NULL (necessário para SET NULL funcionar)
    await queryRunner.query(`
      ALTER TABLE "comanda_paciente" ALTER COLUMN "consultaId" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "comanda_paciente"
        ADD CONSTRAINT "FK_comanda_paciente_consulta"
        FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "comanda_paciente" DROP CONSTRAINT IF EXISTS "FK_comanda_paciente_consulta"`);
    await queryRunner.query(`
      ALTER TABLE "comanda_paciente"
        ADD CONSTRAINT "FK_comanda_paciente_consulta"
        FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE CASCADE
    `);
  }
}
