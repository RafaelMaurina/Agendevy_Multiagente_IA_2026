import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { PerguntaAnamnese } from '@entities/PerguntaAnamnese';
import { RespostaAnamnese } from '@entities/RespostaAnamnese';
import { Paciente } from '@entities/Paciente';
import { In } from 'typeorm';

const pergRepo = () => AppDataSource.getRepository(PerguntaAnamnese);
const respRepo = () => AppDataSource.getRepository(RespostaAnamnese);

export class AnamneseController {
  // ── Perguntas ─────────────────────────────────────────

  static async listPerguntas(_req: Request, res: Response) {
    const items = await pergRepo().find({ where: { ativo: true }, order: { ordem: 'ASC', id: 'ASC' } });
    res.json(items);
  }

  static async createPergunta(req: Request, res: Response) {
    const { texto, tipo, ordem } = req.body;
    if (!texto?.trim()) return res.status(400).json({ message: 'texto é obrigatório' });
    if (tipo !== undefined && !['sim_nao', 'texto'].includes(tipo)) {
      return res.status(400).json({ message: "tipo inválido. Use 'sim_nao' ou 'texto'" });
    }
    const created = pergRepo().create({ texto: texto.trim(), tipo: tipo ?? 'sim_nao', ordem: ordem ?? 0 });
    await pergRepo().save(created);
    res.status(201).json(created);
  }

  static async updatePergunta(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const item = await pergRepo().findOneBy({ id });
    if (!item) return res.status(404).json({ message: 'Pergunta não encontrada' });

    const { texto, tipo, ativo, ordem } = req.body;
    if (texto !== undefined) {
      if (!texto?.trim()) return res.status(400).json({ message: 'texto não pode ser vazio' });
      item.texto = texto.trim();
    }
    if (tipo !== undefined) {
      if (!['sim_nao', 'texto'].includes(tipo)) {
        return res.status(400).json({ message: "tipo inválido. Use 'sim_nao' ou 'texto'" });
      }
      item.tipo = tipo;
    }
    if (ativo !== undefined) item.ativo = ativo;
    if (ordem !== undefined) item.ordem = ordem;

    res.json(await pergRepo().save(item));
  }

  static async removePergunta(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    // Soft delete: apenas desativa
    const item = await pergRepo().findOneBy({ id });
    if (!item) return res.status(404).json({ message: 'Pergunta não encontrada' });
    item.ativo = false;
    await pergRepo().save(item);
    res.status(204).send();
  }

  // ── Respostas de um paciente ──────────────────────────

  static async getRespostasPaciente(req: Request, res: Response) {
    const pacienteId = Number(req.params.pacienteId);
    if (!Number.isInteger(pacienteId) || pacienteId <= 0) return res.status(400).json({ message: 'id inválido' });

    const perguntas = await pergRepo().find({ where: { ativo: true }, order: { ordem: 'ASC', id: 'ASC' } });
    const respostas = await respRepo().find({
      where: { paciente: { id: pacienteId } },
      relations: { pergunta: true },
    });

    // Monta estrutura combinada para o frontend
    const map = new Map(respostas.map((r) => [r.pergunta.id, r]));
    const resultado = perguntas.map((p) => ({
      pergunta: p,
      resposta: map.get(p.id) ?? null,
    }));

    res.json(resultado);
  }

  static async saveRespostasPaciente(req: Request, res: Response) {
    const pacienteId = Number(req.params.pacienteId);
    if (!Number.isInteger(pacienteId) || pacienteId <= 0) return res.status(400).json({ message: 'id inválido' });

    const paciente = await AppDataSource.getRepository(Paciente).findOneBy({ id: pacienteId });
    if (!paciente) return res.status(404).json({ message: 'Paciente não encontrado' });

    // body: [{ pergunta_id, resposta }]
    const items: { pergunta_id: number; resposta: string | null }[] = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ message: 'Esperado array de respostas' });

    const perguntaIds = items.map(i => i.pergunta_id);
    const [perguntas, respostasExistentes] = await Promise.all([
      pergRepo().findBy({ id: In(perguntaIds) }),
      respRepo().find({
        where: { paciente: { id: pacienteId } },
        relations: { pergunta: true },
      }),
    ]);

    const perguntaMap = new Map(perguntas.map(p => [p.id, p]));
    const respostaMap = new Map(respostasExistentes.map(r => [r.pergunta.id, r]));

    const toSave = [];
    for (const item of items) {
      const pergunta = perguntaMap.get(item.pergunta_id);
      if (!pergunta) continue;
      const resp = respostaMap.get(item.pergunta_id);
      if (resp) {
        resp.resposta = item.resposta;
        toSave.push(resp);
      } else {
        toSave.push(respRepo().create({ paciente, pergunta, resposta: item.resposta }));
      }
    }

    if (toSave.length) await respRepo().save(toSave);
    res.json({ ok: true });
  }
}
