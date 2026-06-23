import { MigrationInterface, QueryRunner } from 'typeorm';

// Continuação de SeedCadastrosDemonstracao: dados que dependem dos ids gerados ali (respostas
// de anamnese e a consulta já existente usada no cenário de conflito de horário). Busca os ids
// pelo nome/texto em vez de assumir um valor fixo - não depende de o banco estar vazio antes,
// só de que a migration anterior já tenha rodado.
//
// A consulta pré-existente (Valdivino com Evllyn T em 10/07/2026 14h) é o que faz o 2º cenário
// obrigatório do Agendevy Assistant funcionar de imediato: pedir o mesmo profissional/horário
// para outro paciente (ex: Daniels Djalma Neto Jr) deve responder 409 e o revisor sugerir
// horários alternativos no mesmo dia. Ver agents/README.md, "3 cenários obrigatórios".
export class SeedAnamneseConsultaDemonstracao1700000000008 implements MigrationInterface {
  name = 'SeedAnamneseConsultaDemonstracao1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [valdivino] = await queryRunner.query(
      `SELECT "id" FROM "pacientes" WHERE "nome" = $1 LIMIT 1`,
      ['Valdivino'],
    );
    const [perguntaAlergia] = await queryRunner.query(
      `SELECT "id" FROM "perguntas_anamnese" WHERE "texto" = $1 LIMIT 1`,
      ['Possui alguma alergia a medicamentos?'],
    );
    const [perguntaMedicacao] = await queryRunner.query(
      `SELECT "id" FROM "perguntas_anamnese" WHERE "texto" = $1 LIMIT 1`,
      ['Faz uso de alguma medicação contínua?'],
    );
    const [evllyn] = await queryRunner.query(
      `SELECT "id" FROM "profissionais" WHERE "nome" = $1 LIMIT 1`,
      ['Evllyn T'],
    );
    const [fisioterapia] = await queryRunner.query(
      `SELECT "id" FROM "tipos_consulta" WHERE "nome" = $1 LIMIT 1`,
      ['Fisioterapia - Sessão'],
    );

    if (!valdivino || !perguntaAlergia || !perguntaMedicacao || !evllyn || !fisioterapia) {
      throw new Error(
        'SeedAnamneseConsultaDemonstracao: cadastros base não encontrados - ' +
          'rode SeedCadastrosDemonstracao (migration anterior) antes desta.',
      );
    }

    await queryRunner.query(
      `INSERT INTO "respostas_anamnese" ("pacienteId", "perguntaId", "resposta") VALUES ($1, $2, $3)`,
      [valdivino.id, perguntaAlergia.id, 'Sim, alergia a dipirona.'],
    );
    await queryRunner.query(
      `INSERT INTO "respostas_anamnese" ("pacienteId", "perguntaId", "resposta") VALUES ($1, $2, $3)`,
      [valdivino.id, perguntaMedicacao.id, 'Não, não uso nenhuma medicação contínua.'],
    );

    await queryRunner.query(
      `INSERT INTO "consultas"
         ("data_hora", "horario_fim", "status", "pacienteId", "profissionalId", "tipoConsultaId")
       VALUES ($1, $2, 'agendada', $3, $4, $5)`,
      ['2026-07-10T14:00:00-03:00', '2026-07-10T14:50:00-03:00', valdivino.id, evllyn.id, fisioterapia.id],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "consultas"
      WHERE "data_hora" = '2026-07-10T14:00:00-03:00'
        AND "pacienteId" IN (SELECT "id" FROM "pacientes" WHERE "nome" = 'Valdivino')
        AND "profissionalId" IN (SELECT "id" FROM "profissionais" WHERE "nome" = 'Evllyn T')
    `);
    await queryRunner.query(`
      DELETE FROM "respostas_anamnese"
      WHERE "pacienteId" IN (SELECT "id" FROM "pacientes" WHERE "nome" = 'Valdivino')
        AND "perguntaId" IN (
          SELECT "id" FROM "perguntas_anamnese"
          WHERE "texto" IN (
            'Possui alguma alergia a medicamentos?',
            'Faz uso de alguma medicação contínua?'
          )
        )
    `);
  }
}
