import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Consulta } from '@entities/Consulta';
import { Paciente } from '@entities/Paciente';
import { Profissional } from '@entities/Profissional';
import { TipoConsulta } from '@entities/TipoConsulta';
import { Agendamento } from '@entities/Agendamento';
import { ConsultaAgenda } from '@entities/ConsultaAgenda';
import { BloqueioHorario } from '@entities/BloqueioHorario';
import { ComandaPaciente } from '@entities/ComandaPaciente';
import { criarLancamentoParaConsulta } from './ComandaController';
import { IsNull } from 'typeorm';
import { fmtHHMMFusoLocal } from '../utils/fuso';

const consultaRepo    = () => AppDataSource.getRepository(Consulta);
const pacienteRepo    = () => AppDataSource.getRepository(Paciente);
const profissionalRepo = () => AppDataSource.getRepository(Profissional);
const tipoRepo        = () => AppDataSource.getRepository(TipoConsulta);
const agendaRepo      = () => AppDataSource.getRepository(Agendamento);
const consultaAgendaRepo = () => AppDataSource.getRepository(ConsultaAgenda);
const bloqueioRepo    = () => AppDataSource.getRepository(BloqueioHorario);

// Formata uma Date como "HH:MM" (24h) em -03:00 fixo - nunca no fuso do servidor.
function fmtHHMM(d: Date): string {
  return fmtHHMMFusoLocal(d);
}

/**
 * Verifica se o intervalo [horarioInicio, horarioFim) do profissional
 * conflita com bloqueios ou com outra consulta já existente.
 *
 * Sobreposição: A conflita com B quando A.inicio < B.fim AND B.inicio < A.fim.
 *
 * Para consultas antigas que não possuem horario_fim persistido,
 * usamos COALESCE(horario_fim, data_hora + INTERVAL '30 minutes') como fallback.
 *
 * Retorna null se não houver conflito, ou uma string de mensagem pronta para HTTP 409.
 */
async function verificarConflitoIntervalo(
  profissionalId: number,
  horarioInicio: Date,
  horarioFim: Date,
  excludeConsultaId?: number,
): Promise<string | null> {
  // 1. Conflito com bloqueios de horário (por sobreposição de intervalo)
  const bloqueios = await bloqueioRepo().find({
    where: [
      { profissional: { id: profissionalId } },
      { profissional: IsNull() },
    ],
  });
  for (const b of bloqueios) {
    const bInicio = new Date(b.inicio);
    const bFim    = new Date(b.fim);
    if (horarioInicio < bFim && horarioFim > bInicio) {
      return `Horário bloqueado: ${b.motivo || 'indisponível'} (${bInicio.toLocaleString('pt-BR')} – ${bFim.toLocaleString('pt-BR')})`;
    }
  }

  // 2. Conflito com outra consulta do mesmo profissional (sobreposição de intervalo)
  //    Registros sem horario_fim recebem fallback de +30 minutos a partir de data_hora.
  const params: (number | Date)[] = [profissionalId, horarioFim, horarioInicio];
  let excludeClause = '';
  if (excludeConsultaId) {
    params.push(excludeConsultaId);
    excludeClause = `AND c.id != $${params.length}`;
  }

  const rows: Array<{
    id: number;
    data_hora: string;
    horario_fim: string | null;
    paciente_nome: string;
  }> = await AppDataSource.query(
    `
    SELECT c.id,
           c.data_hora,
           c.horario_fim,
           p.nome AS paciente_nome
    FROM   consultas c
    INNER  JOIN pacientes p ON c."pacienteId" = p.id
    WHERE  c."profissionalId" = $1
      AND  c.data_hora < $2
      AND  COALESCE(c.horario_fim, c.data_hora + INTERVAL '30 minutes') > $3
      ${excludeClause}
    LIMIT  1
    `,
    params,
  );

  if (rows.length > 0) {
    const row  = rows[0];
    const ini  = new Date(row.data_hora);
    const fim  = row.horario_fim
      ? new Date(row.horario_fim)
      : new Date(ini.getTime() + 30 * 60_000);
    return `Conflito de horário: profissional já possui consulta com ${row.paciente_nome} das ${fmtHHMM(ini)} às ${fmtHHMM(fim)}.`;
  }

  return null;
}

// Garante que a consulta esteja vinculada a todas as agendas do profissional responsável.
async function syncConsultaComAgendasDoProfissional(consulta: Consulta) {
  const agendas = await agendaRepo().find({ where: { profissional: { id: consulta.profissional.id } } });
  if (!agendas.length) return;

  for (const agenda of agendas) {
    const exists = await consultaAgendaRepo().findOne({
      where: { agenda: { id: agenda.id }, consulta: { id: consulta.id } },
    });
    if (!exists) {
      await consultaAgendaRepo().save(consultaAgendaRepo().create({ agenda, consulta }));
    }
  }
}

function parseId(value: any): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

const RELATIONS     = { paciente: true, profissional: true, tipo_consulta: true };
const STATUS_VALIDOS = ['aberta', 'agendada', 'realizada', 'cancelada'];

export class ConsultaController {
  static async list(_req: Request, res: Response) {
    const rows = await consultaRepo().find({ relations: RELATIONS, order: { data_hora: 'ASC' } });
    res.json(rows);
  }

  static async get(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const row = await consultaRepo().findOne({ where: { id }, relations: RELATIONS });
    if (!row) return res.status(404).json({ message: 'Consulta não encontrada' });
    res.json(row);
  }

  static async create(req: Request, res: Response) {
    const body         = req.body ?? {};
    const pacienteId   = parseId(body.paciente_id) ?? (body.paciente && parseId(body.paciente.id));
    const profissionalId = parseId(body.profissional_id) ?? (body.profissional && parseId(body.profissional.id));
    const tipoConsultaId = parseId(body.tipo_consulta_id);

    if (!pacienteId)    return res.status(400).json({ message: 'paciente_id é obrigatório' });
    if (!profissionalId) return res.status(400).json({ message: 'profissional_id é obrigatório' });

    const [paciente, profissional] = await Promise.all([
      pacienteRepo().findOne({ where: { id: pacienteId } }),
      profissionalRepo().findOne({ where: { id: profissionalId } }),
    ]);
    if (!paciente)    return res.status(404).json({ message: 'Paciente não encontrado' });
    if (!profissional) return res.status(404).json({ message: 'Profissional não encontrado' });

    let tipo_consulta: TipoConsulta | null = null;
    if (tipoConsultaId) {
      tipo_consulta = await tipoRepo().findOneBy({ id: tipoConsultaId });
    }

    const created = consultaRepo().create({
      nome_consulta: body.nome_consulta ?? null,
      data_hora:     body.data_hora,
      status:        'aberta',
    });
    created.paciente     = paciente;
    created.profissional = profissional;
    created.tipo_consulta = tipo_consulta;
    if (!created.nome_consulta && tipo_consulta) created.nome_consulta = tipo_consulta.nome;

    // Calcula horario_fim e verifica sobreposição de intervalo antes de salvar
    if (created.data_hora) {
      const duracao   = tipo_consulta?.duracao_minutos ?? 30;
      const horarioInicio = new Date(created.data_hora);
      const horarioFim    = new Date(horarioInicio.getTime() + duracao * 60_000);
      created.horario_fim = horarioFim;

      const conflito = await verificarConflitoIntervalo(profissionalId, horarioInicio, horarioFim);
      if (conflito) return res.status(409).json({ message: conflito });
    }

    let saved: Consulta;
    try {
      saved = await consultaRepo().save(created);
    } catch (err: any) {
      if (err?.code === '23505') {
        return res.status(409).json({ message: 'Conflito de horário: profissional já possui consulta neste horário.' });
      }
      throw err;
    }
    await syncConsultaComAgendasDoProfissional(saved);

    const savedComTipo = await consultaRepo().findOne({ where: { id: saved.id }, relations: { paciente: true, tipo_consulta: true } });
    if (savedComTipo) await criarLancamentoParaConsulta(savedComTipo);

    const result = await consultaRepo().findOne({ where: { id: saved.id }, relations: RELATIONS });
    res.status(201).json(result);
  }

  static async update(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const consulta = await consultaRepo().findOne({ where: { id }, relations: RELATIONS });
    if (!consulta) return res.status(404).json({ message: 'Consulta não encontrada' });

    const body           = req.body ?? {};
    const pacienteId     = body.hasOwnProperty('paciente_id')    ? parseId(body.paciente_id)    : (body.paciente?.id    ? parseId(body.paciente.id)    : null);
    const profissionalId = body.hasOwnProperty('profissional_id') ? parseId(body.profissional_id) : (body.profissional?.id ? parseId(body.profissional.id) : null);
    const tipoConsultaId = body.hasOwnProperty('tipo_consulta_id') ? parseId(body.tipo_consulta_id) : undefined;

    if (pacienteId !== null && pacienteId !== undefined) {
      const paciente = await pacienteRepo().findOne({ where: { id: pacienteId } });
      if (!paciente) return res.status(404).json({ message: 'Paciente não encontrado' });
      consulta.paciente = paciente;
    }
    if (profissionalId !== null && profissionalId !== undefined) {
      const profissional = await profissionalRepo().findOne({ where: { id: profissionalId } });
      if (!profissional) return res.status(404).json({ message: 'Profissional não encontrado' });
      consulta.profissional = profissional;
    }
    if (tipoConsultaId !== undefined) {
      consulta.tipo_consulta = tipoConsultaId ? await tipoRepo().findOneBy({ id: tipoConsultaId }) : null;
      if (consulta.tipo_consulta && !body.nome_consulta) consulta.nome_consulta = consulta.tipo_consulta.nome;
    }

    if (body.data_hora   !== undefined) consulta.data_hora = body.data_hora;
    if (body.status      !== undefined) {
      if (!STATUS_VALIDOS.includes(body.status)) {
        return res.status(400).json({ message: `status inválido. Valores permitidos: ${STATUS_VALIDOS.join(', ')}` });
      }
      consulta.status = body.status;
    }
    if (body.nome_consulta !== undefined) consulta.nome_consulta = body.nome_consulta;

    // Recalcula horario_fim e verifica sobreposição de intervalo
    if (consulta.data_hora) {
      const duracao       = consulta.tipo_consulta?.duracao_minutos ?? 30;
      const horarioInicio = new Date(consulta.data_hora);
      const horarioFim    = new Date(horarioInicio.getTime() + duracao * 60_000);
      consulta.horario_fim = horarioFim;

      const profId = consulta.profissional?.id;
      if (profId) {
        const conflito = await verificarConflitoIntervalo(profId, horarioInicio, horarioFim, id);
        if (conflito) return res.status(409).json({ message: conflito });
      }
    }

    let saved: Consulta;
    try {
      saved = await consultaRepo().save(consulta);
    } catch (err: any) {
      if (err?.code === '23505') {
        return res.status(409).json({ message: 'Conflito de horário: profissional já possui consulta neste horário.' });
      }
      throw err;
    }
    await syncConsultaComAgendasDoProfissional(saved);

    // Sincroniza o lançamento financeiro SEMPRE (não só quando o tipo veio no body): a função
    // é idempotente - cria se não existe, atualiza o valor se o tipo/valor mudou, ou remove se
    // a consulta passou a não ter valor. Antes isso só rodava quando tipo_consulta_id era
    // enviado, então editar o tipo (ou seu valor) deixava o financeiro desatualizado.
    const savedComTipo = await consultaRepo().findOne({ where: { id: saved.id }, relations: { paciente: true, tipo_consulta: true } });
    if (savedComTipo) await criarLancamentoParaConsulta(savedComTipo);

    const updated = await consultaRepo().findOne({ where: { id: saved.id }, relations: RELATIONS });
    res.json(updated);
  }

  static async remove(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const existente = await consultaRepo().findOneBy({ id });
    if (!existente) return res.status(404).json({ message: 'Consulta não encontrada' });

    await consultaAgendaRepo().delete({ consulta: { id } });
    await AppDataSource.getRepository(ComandaPaciente)
      .createQueryBuilder()
      .update()
      .set({ consulta: null })
      .where('"consultaId" = :id', { id })
      .execute();

    const result = await consultaRepo().delete(id);
    if (!result.affected) return res.status(404).json({ message: 'Consulta não encontrada' });
    res.status(204).send();
  }

  static async syncAllAgendas(_req: Request, res: Response) {
    const consultas = await consultaRepo().find({ relations: { profissional: true } });

    let processadas    = 0;
    let vinculosCriados = 0;

    for (const consulta of consultas) {
      if (!consulta.profissional) continue;

      const agendas = await agendaRepo().find({ where: { profissional: { id: consulta.profissional.id } } });
      for (const agenda of agendas) {
        const exists = await consultaAgendaRepo().findOne({
          where: { agenda: { id: agenda.id }, consulta: { id: consulta.id } },
        });
        if (!exists) {
          await consultaAgendaRepo().save(consultaAgendaRepo().create({ agenda, consulta }));
          vinculosCriados++;
        }
      }
      processadas++;
    }

    res.json({ consultas_processadas: processadas, vinculos_criados: vinculosCriados });
  }
}
