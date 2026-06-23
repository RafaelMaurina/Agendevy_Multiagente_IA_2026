import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Agendamento } from '@entities/Agendamento';
import { Consulta } from '@entities/Consulta';
import { ConsultaAgenda } from '@entities/ConsultaAgenda';
import { Profissional } from '@entities/Profissional';

const agendaRepo = () => AppDataSource.getRepository(Agendamento);
const consultaRepo = () => AppDataSource.getRepository(Consulta);
const consultaAgendaRepo = () => AppDataSource.getRepository(ConsultaAgenda);

export class AgendamentoController {
  static async list(_req: Request, res: Response) {
    const items = await agendaRepo().find({
      relations: { profissional: true, consultas: { consulta: true } },
      order: { id: 'ASC' },
    });
    res.json(items);
  }

  static async get(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const a = await agendaRepo().findOne({
      where: { id },
      relations: { profissional: true, consultas: { consulta: true } },
    });
    if (!a) return res.status(404).json({ message: 'Agenda não encontrada' }); // era 'Agenda not found'
    res.json(a);
  }

  static async create(req: Request, res: Response) {
    const { nome, profissional } = req.body;
    if (!nome || !profissional)
      return res.status(400).json({ message: 'Nome e profissional são obrigatórios' });

    const profId = typeof profissional === 'object' ? Number(profissional.id) : Number(profissional);
    if (!profId || Number.isNaN(profId))
      return res.status(400).json({ message: 'Profissional inválido' });

    const prof = await AppDataSource.getRepository(Profissional).findOneBy({ id: profId });
    if (!prof) return res.status(404).json({ message: 'Profissional não encontrado' });

    const created = agendaRepo().create({ nome, profissional: prof });
    await agendaRepo().save(created);
    res.status(201).json(created);
  }

  static async update(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const agenda = await agendaRepo().findOneBy({ id });
    if (!agenda) return res.status(404).json({ message: 'Agenda não encontrada' });

    if (req.body.nome !== undefined) agenda.nome = req.body.nome;
    const saved = await agendaRepo().save(agenda);
    const updated = await agendaRepo().findOne({
      where: { id: saved.id },
      relations: { profissional: true, consultas: { consulta: true } },
    });
    res.json(updated);
  }

  static async remove(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const result = await agendaRepo().delete(id);
    if (!result.affected) return res.status(404).json({ message: 'Agenda não encontrada' });
    res.status(204).send();
  }

  static async addConsulta(req: Request, res: Response) {
    const agendaId = Number(req.params.id);
    if (!Number.isInteger(agendaId) || agendaId <= 0) return res.status(400).json({ message: 'id inválido' });

    const consultaId = Number(req.body.consulta_id);
    if (!consultaId) return res.status(400).json({ message: 'consulta_id é obrigatório' });

    const [agenda, consulta] = await Promise.all([
      agendaRepo().findOneBy({ id: agendaId }),
      consultaRepo().findOne({ where: { id: consultaId }, relations: { profissional: true } }),
    ]);

    if (!agenda) return res.status(404).json({ message: 'Agenda não encontrada' });
    if (!consulta) return res.status(404).json({ message: 'Consulta não encontrada' });

    const exists = await consultaAgendaRepo().findOne({
      where: { agenda: { id: agendaId }, consulta: { id: consultaId } },
    });
    if (exists) return res.status(409).json({ message: 'Consulta já está na agenda' });

    const item = consultaAgendaRepo().create({ agenda, consulta });
    await consultaAgendaRepo().save(item);

    const saved = await consultaAgendaRepo().findOne({
      where: { id: item.id },
      relations: { consulta: true, agenda: true },
    });
    res.status(201).json(saved);
  }

  static async listConsultas(req: Request, res: Response) {
    const agendaId = Number(req.params.id);
    if (!Number.isInteger(agendaId) || agendaId <= 0) return res.status(400).json({ message: 'id inválido' });

    const items = await consultaAgendaRepo().find({
      where: { agenda: { id: agendaId } },
      relations: { consulta: true },
      order: { added_at: 'ASC', id: 'ASC' },
    });
    res.json(items);
  }

  static async removeConsulta(req: Request, res: Response) {
    const agendaId = Number(req.params.id);
    const consultaId = Number(req.params.consultaId);
    if (!Number.isInteger(agendaId) || agendaId <= 0 || !Number.isInteger(consultaId) || consultaId <= 0) {
      return res.status(400).json({ message: 'id inválido' });
    }

    const rel = await consultaAgendaRepo().findOne({
      where: { agenda: { id: agendaId }, consulta: { id: consultaId } },
    });
    if (!rel) return res.status(404).json({ message: 'Consulta não encontrada na agenda' });

    await consultaAgendaRepo().delete(rel.id);
    res.status(204).send();
  }
}
