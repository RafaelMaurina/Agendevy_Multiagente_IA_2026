import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Profissional } from '@entities/Profissional';
import { Consulta } from '@entities/Consulta';

const profissionalRepo = () => AppDataSource.getRepository(Profissional);

export class ProfissionalController {
  static async list(_req: Request, res: Response) {
    const items = await profissionalRepo().find({ order: { id: 'ASC' } });
    res.json(items);
  }

  static async get(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const p = await profissionalRepo().findOne({ where: { id } });
    if (!p) return res.status(404).json({ message: 'Profissional não encontrado :c' });
    res.json(p);
  }

  static async create(req: Request, res: Response) {
    const { nome, especialidade, registro_conselho, registro_numero } = req.body;
    if (!nome) return res.status(400).json({ message: 'Nome é obrigatório ;)' });

    const created = profissionalRepo().create({
      nome,
      especialidade,
      registro_conselho: registro_conselho ?? null,
      registro_numero: registro_numero ?? null,
    });
    await profissionalRepo().save(created);
    res.status(201).json(created);
  }

  static async update(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const { nome, especialidade, registro_conselho, registro_numero } = req.body;
    const profissional = await profissionalRepo().findOneBy({ id });
    if (!profissional) return res.status(404).json({ message: 'Profissional não encontrado :c' });

    if (nome !== undefined) profissional.nome = nome;
    if (especialidade !== undefined) profissional.especialidade = especialidade;
    if (registro_conselho !== undefined) profissional.registro_conselho = registro_conselho || null;
    if (registro_numero !== undefined) profissional.registro_numero = registro_numero || null;

    const saved = await profissionalRepo().save(profissional);
    res.json(saved);
  }

  static async remove(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    // A FK Consulta.profissional é ON DELETE CASCADE - excluir o profissional
    // apagaria permanentemente todo o histórico de consultas (e indiretamente
    // desvincularia pagamentos já registrados). Bloqueamos aqui para evitar
    // perda de dados silenciosa; o usuário precisa reatribuir/excluir as
    // consultas explicitamente antes de remover o profissional.
    const totalConsultas = await AppDataSource.getRepository(Consulta).count({
      where: { profissional: { id } },
    });
    if (totalConsultas > 0) {
      return res.status(409).json({
        message: `Não é possível excluir: este profissional possui ${totalConsultas} consulta(s) registrada(s). Reatribua ou remova as consultas primeiro.`,
      });
    }

    const result = await profissionalRepo().delete(id);
    if (!result.affected) return res.status(404).json({ message: 'Profissional não encontrado :c' });
    res.status(204).send();
  }
}
