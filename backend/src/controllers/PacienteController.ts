import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Paciente } from '@entities/Paciente';
import { Consulta } from '@entities/Consulta';
import { ComandaPaciente } from '@entities/ComandaPaciente';

const pacienteRepo = () => AppDataSource.getRepository(Paciente);

export class PacienteController {
  static async list(_req: Request, res: Response) {
    const items = await pacienteRepo().find({ order: { id: 'ASC' } });
    res.json(items);
  }

  static async get(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const p = await pacienteRepo().findOne({ where: { id } });
    if (!p) return res.status(404).json({ message: 'Paciente não encontrado :c' });
    res.json(p);
  }

  static async create(req: Request, res: Response) {
    const { nome, telefone, email, data_nascimento, observacoes } = req.body;
    if (!nome) return res.status(400).json({ message: 'Nome é obrigatório ;)' });

    const created = pacienteRepo().create({ nome, telefone, email: email ?? null, data_nascimento: data_nascimento ?? null, observacoes: observacoes ?? null });
    await pacienteRepo().save(created);
    res.status(201).json(created);
  }

  static async update(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const { nome, telefone, email, data_nascimento, observacoes } = req.body;
    const paciente = await pacienteRepo().findOneBy({ id });
    if (!paciente) return res.status(404).json({ message: 'Paciente não encontrado :c' });

    if (nome !== undefined) paciente.nome = nome;
    if (telefone !== undefined) paciente.telefone = telefone;
    if (email !== undefined) paciente.email = email;
    if (data_nascimento !== undefined) paciente.data_nascimento = data_nascimento;
    if (observacoes !== undefined) paciente.observacoes = observacoes;

    const saved = await pacienteRepo().save(paciente);
    res.json(saved);
  }

  static async remove(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    // Consulta.paciente e ComandaPaciente.paciente são ON DELETE CASCADE - excluir
    // o paciente apagaria permanentemente seu histórico de consultas E financeiro
    // (créditos pagos, pagamentos confirmados). Bloqueamos para evitar perda de
    // dados irreversível, especialmente registros financeiros.
    const [totalConsultas, totalLancamentos] = await Promise.all([
      AppDataSource.getRepository(Consulta).count({ where: { paciente: { id } } }),
      AppDataSource.getRepository(ComandaPaciente).count({ where: { paciente: { id } } }),
    ]);
    if (totalConsultas > 0 || totalLancamentos > 0) {
      return res.status(409).json({
        message: `Não é possível excluir: este paciente possui ${totalConsultas} consulta(s) e ${totalLancamentos} lançamento(s) financeiro(s) registrado(s). Esses dados precisam ser tratados antes da exclusão.`,
      });
    }

    const result = await pacienteRepo().delete(id);
    if (!result.affected) return res.status(404).json({ message: 'Paciente não encontrado :c' });
    res.status(204).send();
  }
}
