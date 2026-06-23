import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { TipoConsulta } from '@entities/TipoConsulta';

const repo = () => AppDataSource.getRepository(TipoConsulta);

export class TipoConsultaController {
  static async list(_req: Request, res: Response) {
    const items = await repo().find({ order: { nome: 'ASC' } });
    res.json(items);
  }

  static async get(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const item = await repo().findOneBy({ id });
    if (!item) return res.status(404).json({ message: 'Tipo de consulta não encontrado' });
    res.json(item);
  }

  static async create(req: Request, res: Response) {
    const { nome, valor_padrao, duracao_minutos } = req.body;
    if (!nome?.trim()) return res.status(400).json({ message: 'Nome é obrigatório' });

    let valorNum: number | null = null;
    if (valor_padrao !== undefined && valor_padrao !== null && valor_padrao !== '') {
      valorNum = Number(valor_padrao);
      if (!Number.isFinite(valorNum) || valorNum < 0) {
        return res.status(400).json({ message: 'valor_padrao inválido' });
      }
    }

    let duracaoNum = 30;
    if (duracao_minutos !== undefined && duracao_minutos !== null && duracao_minutos !== '') {
      duracaoNum = parseInt(String(duracao_minutos), 10);
      if (!Number.isInteger(duracaoNum) || duracaoNum < 1) {
        return res.status(400).json({ message: 'duracao_minutos deve ser um inteiro maior que zero' });
      }
    }

    const created = repo().create({ nome: nome.trim(), valor_padrao: valorNum, duracao_minutos: duracaoNum });
    await repo().save(created);
    res.status(201).json(created);
  }

  static async update(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const item = await repo().findOneBy({ id });
    if (!item) return res.status(404).json({ message: 'Tipo de consulta não encontrado' });

    const { nome, valor_padrao, duracao_minutos } = req.body;
    if (nome !== undefined) {
      if (!nome?.trim()) return res.status(400).json({ message: 'Nome não pode ser vazio' });
      item.nome = nome.trim();
    }
    if (valor_padrao !== undefined) {
      if (valor_padrao === null || valor_padrao === '') {
        item.valor_padrao = null;
      } else {
        const valorNum = Number(valor_padrao);
        if (!Number.isFinite(valorNum) || valorNum < 0) {
          return res.status(400).json({ message: 'valor_padrao inválido' });
        }
        item.valor_padrao = valorNum;
      }
    }
    if (duracao_minutos !== undefined && duracao_minutos !== null && duracao_minutos !== '') {
      const duracaoNum = parseInt(String(duracao_minutos), 10);
      if (!Number.isInteger(duracaoNum) || duracaoNum < 1) {
        return res.status(400).json({ message: 'duracao_minutos deve ser um inteiro maior que zero' });
      }
      item.duracao_minutos = duracaoNum;
    }

    const saved = await repo().save(item);
    res.json(saved);
  }

  static async remove(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const result = await repo().delete(id);
    if (!result.affected) return res.status(404).json({ message: 'Tipo de consulta não encontrado' });
    res.status(204).send();
  }
}
