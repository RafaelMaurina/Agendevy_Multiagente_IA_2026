import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { BloqueioHorario } from '@entities/BloqueioHorario';
import { Profissional } from '@entities/Profissional';

const repo = () => AppDataSource.getRepository(BloqueioHorario);
const profRepo = () => AppDataSource.getRepository(Profissional);

export class BloqueioHorarioController {
  static async list(_req: Request, res: Response) {
    const rows = await repo().find({ relations: { profissional: true }, order: { inicio: 'ASC' } });
    res.json(rows);
  }

  static async create(req: Request, res: Response) {
    const { inicio, fim, motivo, profissional_id } = req.body ?? {};
    if (!inicio || !fim) return res.status(400).json({ message: 'inicio e fim são obrigatórios' });
    if (new Date(fim) <= new Date(inicio)) {
      return res.status(400).json({ message: 'fim deve ser depois de inicio' });
    }

    const bloqueio = repo().create({ inicio, fim, motivo: motivo || null });

    if (profissional_id) {
      const prof = await profRepo().findOneBy({ id: Number(profissional_id) });
      if (!prof) return res.status(404).json({ message: 'Profissional não encontrado' });
      bloqueio.profissional = prof;
    } else {
      bloqueio.profissional = null;
    }

    const saved = await repo().save(bloqueio);
    res.status(201).json(saved);
  }

  static async remove(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const result = await repo().delete(id);
    if (!result.affected) return res.status(404).json({ message: 'Bloqueio não encontrado' });
    res.status(204).send();
  }
}
