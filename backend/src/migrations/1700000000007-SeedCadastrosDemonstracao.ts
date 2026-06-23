import { MigrationInterface, QueryRunner } from 'typeorm';

// Popula os cadastros base (sem relação entre si) necessários para o Agendevy Assistant
// (agents/main.py) funcionar assim que o backend subir, sem exigir cadastro manual via API ou
// frontend antes de demonstrar o sistema. Nomes de paciente/profissional usam os dados reais
// já cadastrados pelo Rafael (Valdivino, Evllyn T) em vez de uma fixture totalmente fictícia -
// se você já tiver esses nomes no seu próprio banco, rodar esta migration cria registros NOVOS
// (ids diferentes), não duplica/conflita com os existentes. Os tipos de consulta espelham
// exatamente os 5 documentos de `agents/rag/knowledge_base/` (mesmos nomes) + "Consulta de
// rotina" (tipo real do Rafael, com doc próprio na base de conhecimento), para a base de
// conhecimento do RAG ter sempre um tipo de atendimento real correspondente a cada documento.
// A continuação (anamnese + consulta de demonstração, que dependem destes ids) está na
// migration seguinte (SeedAnamneseConsultaDemonstracao).
export class SeedCadastrosDemonstracao1700000000007 implements MigrationInterface {
  name = 'SeedCadastrosDemonstracao1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "profissionais" ("nome", "especialidade") VALUES
        ('Evllyn T', 'Fisioterapeuta')
    `);

    await queryRunner.query(`
      INSERT INTO "tipos_consulta" ("nome", "valor_padrao", "duracao_minutos") VALUES
        ('Fisioterapia - Sessão', 120.00, 50),
        ('Avaliação Postural', 150.00, 60),
        ('RPG - Reeducação Postural Global', 130.00, 60),
        ('Pilates Clínico', 100.00, 50),
        ('Acupuntura', 110.00, 40),
        ('Consulta de rotina', 60.00, 60)
    `);

    // Marga Almeida (sem nenhum lançamento financeiro) e Daniels Djalma Neto Jr ficam sem
    // `observacoes` de propósito - só Valdivino tem histórico clínico, usado no cenário de RAG
    // sobre paciente (ver migration seguinte e agents/README.md, "3 cenários obrigatórios").
    await queryRunner.query(`
      INSERT INTO "pacientes" ("nome", "telefone", "observacoes") VALUES
        ('Valdivino', '54999990000', 'Dor lombar crônica há 2 anos.')
    `);
    await queryRunner.query(`
      INSERT INTO "pacientes" ("nome", "telefone") VALUES
        ('Marga Almeida', '54988880000'),
        ('Daniels Djalma Neto Jr', '54977770000')
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
      DELETE FROM "pacientes" WHERE "nome" IN ('Valdivino', 'Marga Almeida', 'Daniels Djalma Neto Jr')
    `);
    await queryRunner.query(`
      DELETE FROM "profissionais" WHERE "nome" IN ('Evllyn T')
    `);
    await queryRunner.query(`
      DELETE FROM "perguntas_anamnese" WHERE "texto" IN (
        'Possui alguma alergia a medicamentos?', 'Faz uso de alguma medicação contínua?'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "tipos_consulta" WHERE "nome" IN (
        'Fisioterapia - Sessão', 'Avaliação Postural', 'RPG - Reeducação Postural Global',
        'Pilates Clínico', 'Acupuntura', 'Consulta de rotina'
      )
    `);
  }
}
