import { MigrationInterface, QueryRunner } from 'typeorm';

// Popula os cadastros base (sem relação entre si) necessários para o Agendevy Assistant
// (agents/main.py) funcionar assim que o backend subir, sem exigir cadastro manual via API ou
// frontend antes de demonstrar o sistema. Os tipos de consulta espelham exatamente os 5
// documentos de `agents/rag/knowledge_base/` (mesmos nomes), para a base de conhecimento do RAG
// ter sempre um tipo de atendimento real correspondente a cada documento.
// A continuação (anamnese + consulta de demonstração, que dependem destes ids) está na
// migration seguinte (SeedAnamneseConsultaDemonstracao).
export class SeedCadastrosDemonstracao1700000000007 implements MigrationInterface {
  name = 'SeedCadastrosDemonstracao1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "profissionais" ("nome", "especialidade") VALUES
        ('Camila Souza', 'Fisioterapia'),
        ('Marina Telles', 'Acupuntura')
    `);

    await queryRunner.query(`
      INSERT INTO "tipos_consulta" ("nome", "valor_padrao", "duracao_minutos") VALUES
        ('Fisioterapia - Sessão', 120.00, 50),
        ('Avaliação Postural', 150.00, 60),
        ('RPG - Reeducação Postural Global', 130.00, 60),
        ('Pilates Clínico', 100.00, 50),
        ('Acupuntura', 110.00, 40)
    `);

    // Renata Lima (sem nenhum lançamento financeiro) e Sérgio Mendes ficam sem `observacoes` de
    // propósito - só João Pedro Alves tem histórico clínico, usado no cenário de RAG sobre
    // paciente (ver migration seguinte e agents/README.md, "3 cenários obrigatórios").
    await queryRunner.query(`
      INSERT INTO "pacientes" ("nome", "telefone", "observacoes") VALUES
        ('João Pedro Alves', '54999990000', 'Dor lombar crônica há 2 anos.')
    `);
    await queryRunner.query(`
      INSERT INTO "pacientes" ("nome", "telefone") VALUES
        ('Renata Lima', '54988880000'),
        ('Sérgio Mendes', '54977770000')
    `);

    await queryRunner.query(`
      INSERT INTO "perguntas_anamnese" ("texto", "tipo", "ordem") VALUES
        ('Possui alguma alergia a medicamentos?', 'texto', 1),
        ('Faz uso de alguma medicação contínua?', 'texto', 2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // CASCADE em pacientes/profissionais já remove consultas e respostas_anamnese vinculadas
    // (criadas pela migration seguinte) - por isso o down() dela deve rodar antes deste, mas
    // mesmo que não rode, apagar os cadastros base aqui não deixa nada orfão.
    await queryRunner.query(`
      DELETE FROM "pacientes" WHERE "nome" IN ('João Pedro Alves', 'Renata Lima', 'Sérgio Mendes')
    `);
    await queryRunner.query(`
      DELETE FROM "profissionais" WHERE "nome" IN ('Camila Souza', 'Marina Telles')
    `);
    await queryRunner.query(`
      DELETE FROM "perguntas_anamnese" WHERE "texto" IN (
        'Possui alguma alergia a medicamentos?', 'Faz uso de alguma medicação contínua?'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "tipos_consulta" WHERE "nome" IN (
        'Fisioterapia - Sessão', 'Avaliação Postural', 'RPG - Reeducação Postural Global',
        'Pilates Clínico', 'Acupuntura'
      )
    `);
  }
}
