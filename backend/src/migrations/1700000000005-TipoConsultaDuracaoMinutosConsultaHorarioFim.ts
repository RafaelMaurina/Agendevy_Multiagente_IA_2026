import { MigrationInterface, QueryRunner } from 'typeorm';

// Adiciona duracao_minutos em tipos_consulta (duração padrão de cada tipo de atendimento)
// e horario_fim em consultas (fim calculado = horario_inicio + duracao do tipo).
// A coluna horario_fim é nullable para compatibilidade com registros existentes;
// a lógica de conflito faz COALESCE(horario_fim, data_hora + '30 min') para registros antigos.
export class TipoConsultaDuracaoMinutosConsultaHorarioFim1700000000005 implements MigrationInterface {
  name = 'TipoConsultaDuracaoMinutosConsultaHorarioFim1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tipos_consulta"
        ADD COLUMN IF NOT EXISTS "duracao_minutos" INTEGER NOT NULL DEFAULT 30
    `);
    await queryRunner.query(`
      ALTER TABLE "consultas"
        ADD COLUMN IF NOT EXISTS "horario_fim" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "consultas" DROP COLUMN IF EXISTS "horario_fim"`);
    await queryRunner.query(`ALTER TABLE "tipos_consulta" DROP COLUMN IF EXISTS "duracao_minutos"`);
  }
}
