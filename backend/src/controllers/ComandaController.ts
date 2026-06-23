import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { ComandaPaciente } from '@entities/ComandaPaciente';
import { Paciente } from '@entities/Paciente';
import { Consulta } from '@entities/Consulta';
import { calcularSaldo } from '../services/SaldoService';
import { hojeFusoLocal } from '../utils/fuso';

const repo = () => AppDataSource.getRepository(ComandaPaciente);

const FORMAS_PGTO_VALIDAS = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'credito_sessoes', 'credito_saldo'];
const TIPOS_CREDITO_VALIDOS = ['monetario', 'sessoes'];

/** Retorna a data de hoje como YYYY-MM-DD em -03:00 fixo (nunca no fuso do servidor). */
function localDateToday(): string {
  return hojeFusoLocal();
}

// ---------------------------------------------------------------------------
// Aplica a lógica de consumo de crédito em um lançamento de pagamento.
// Deve ser chamado DENTRO de uma transação (manager do queryRunner) para que
// a leitura do saldo e a gravação do lançamento sejam atômicas - evitando
// a race condition em que duas requisições simultâneas debitam o mesmo saldo.
// ---------------------------------------------------------------------------
async function aplicarFormaPagamento(
  entry: Partial<ComandaPaciente> & { paciente: { id: number } },
  manager: import('typeorm').EntityManager,
  entryId?: number,
) {
  if (entry.is_credito) return;

  if (entry.forma_pgto === 'credito_saldo') {
    const { saldoMonetario } = await calcularSaldo(manager, entry.paciente.id, entryId);
    const valor = Number(entry.valor ?? 0);
    if (valor > 0 && saldoMonetario >= valor) {
      entry.status_pgto = 'pago';
      entry.sessoes_consumidas = null;
    } else {
      entry.status_pgto = 'pendente';
      entry.forma_pgto = null;
      entry.sessoes_consumidas = null;
    }
    return;
  }

  if (entry.forma_pgto === 'credito_sessoes') {
    const valor = Number(entry.valor ?? 0);
    const { sessoesDisponiveis } = await calcularSaldo(manager, entry.paciente.id, entryId);
    if (valor > 0 && sessoesDisponiveis > 0) {
      entry.status_pgto = 'pago';
      entry.sessoes_consumidas = 1;
    } else {
      entry.status_pgto = 'pendente';
      entry.forma_pgto = null;
      entry.sessoes_consumidas = null;
    }
    return;
  }

  if (entry.sessoes_consumidas) entry.sessoes_consumidas = null;

  // Para qualquer forma de pagamento comum (dinheiro, pix, cartão, etc.),
  // se uma forma foi informada o pagamento está confirmado. Se a forma foi
  // removida (usuário selecionou "- Em aberto -" ao editar), volta a pendente
  // - evita ficar com status_pgto='pago' sem nenhuma forma de pagamento definida.
  entry.status_pgto = entry.forma_pgto ? 'pago' : 'pendente';
}

// ---------------------------------------------------------------------------
// Cria automaticamente um lançamento financeiro para uma consulta recém-criada.
// Executado dentro de uma transação para garantir atomicidade do débito.
// ---------------------------------------------------------------------------
export async function criarLancamentoParaConsulta(consulta: Consulta) {
  return sincronizarLancamentoDaConsulta(consulta);
}

/**
 * Cria, atualiza ou remove o lançamento financeiro automático de uma consulta, de forma
 * idempotente - pode ser chamada tanto na criação quanto em qualquer edição da consulta.
 *
 * Regras (corrige o bug em que editar uma consulta não atualizava o valor cobrado):
 * - Tipo de consulta sem valor padrão (gratuito/sem tipo): se existir um lançamento automático
 *   AINDA pendente (não pago manualmente), ele é removido; um lançamento já pago é preservado
 *   para não apagar histórico financeiro.
 * - Já existe lançamento para a consulta: atualiza o valor para o valor padrão atual do tipo.
 *   Se o lançamento ainda não foi quitado (pendente, sem forma de pagamento definida pelo
 *   usuário), reavalia a cobertura por crédito com o novo valor. Se já foi pago (manualmente ou
 *   por crédito), o valor é atualizado mas a forma/status de pagamento são preservados - não
 *   reabrimos um pagamento que o usuário já registrou.
 * - Não existe lançamento: cria um novo (comportamento original da criação).
 *
 * Tudo dentro de uma transação, reusando calcularSaldo(manager) para evitar race de crédito.
 */
export async function sincronizarLancamentoDaConsulta(consulta: Consulta) {
  const pacienteId = consulta.paciente?.id;
  if (!pacienteId) return;

  const valorPadrao = consulta.tipo_consulta?.valor_padrao;
  const temValor = valorPadrao !== null && valorPadrao !== undefined;
  const valor = temValor ? Number(valorPadrao) : 0;

  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const existente = await queryRunner.manager.findOne(ComandaPaciente, {
      where: { consulta: { id: consulta.id }, is_credito: false },
      relations: { paciente: true },
    });

    // Tipo sem valor (gratuito ou sem tipo): não deve haver cobrança automática.
    if (!temValor) {
      if (existente && existente.status_pgto !== 'pago') {
        await queryRunner.manager.remove(existente);
      }
      await queryRunner.commitTransaction();
      return;
    }

    if (existente) {
      const jaQuitado = existente.status_pgto === 'pago';
      existente.valor = valor;
      if (!jaQuitado) {
        // Lançamento ainda em aberto: reavalia cobertura por crédito com o novo valor.
        const { saldoMonetario, sessoesDisponiveis } = await calcularSaldo(
          queryRunner.manager, pacienteId, existente.id,
        );
        if (sessoesDisponiveis > 0) {
          existente.forma_pgto = 'credito_sessoes';
          existente.status_pgto = 'pago';
          existente.data_pgto = localDateToday();
          existente.sessoes_consumidas = 1;
        } else if (saldoMonetario >= valor && valor > 0) {
          existente.forma_pgto = 'credito_saldo';
          existente.status_pgto = 'pago';
          existente.data_pgto = localDateToday();
          existente.sessoes_consumidas = null;
        }
        // senão permanece pendente, agora com o valor atualizado.
      }
      // Se já quitado: atualiza só o valor, preserva forma/status/data de pagamento.
      await queryRunner.manager.save(existente);
      await queryRunner.commitTransaction();
      return;
    }

    // Não existe lançamento ainda: cria um novo.
    const { saldoMonetario, sessoesDisponiveis } = await calcularSaldo(
      queryRunner.manager, pacienteId,
    );

    let forma_pgto: ComandaPaciente['forma_pgto'] = null;
    let status_pgto: ComandaPaciente['status_pgto'] = 'pendente';
    let data_pgto: string | null = null;
    let sessoesConsumidasNoLancamento: number | null = null;

    if (sessoesDisponiveis > 0) {
      forma_pgto = 'credito_sessoes';
      status_pgto = 'pago';
      data_pgto = localDateToday();
      sessoesConsumidasNoLancamento = 1;
    } else if (saldoMonetario >= valor && valor > 0) {
      forma_pgto = 'credito_saldo';
      status_pgto = 'pago';
      data_pgto = localDateToday();
    }

    const entry = queryRunner.manager.create(ComandaPaciente, {
      paciente: { id: pacienteId } as Paciente,
      consulta,
      valor,
      data_pgto,
      forma_pgto,
      status_pgto,
      is_credito: false,
      tipo_credito: null,
      sessoes_qty: null,
      sessoes_consumidas: sessoesConsumidasNoLancamento,
      observacao: 'Gerado automaticamente a partir da consulta',
    });

    await queryRunner.manager.save(entry);
    await queryRunner.commitTransaction();
  } catch (err: any) {
    await queryRunner.rollbackTransaction();
    // Corrida rara: outro request criou o lançamento entre o findOne e o save. Ignora.
    if (err?.code === '23505') return;
    throw err;
  } finally {
    await queryRunner.release();
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
export class ComandaController {
  static async getById(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'id inválido' });

    const item = await repo().findOne({
      where: { id },
      relations: { paciente: true, consulta: { tipo_consulta: true } },
    });
    if (!item) return res.status(404).json({ message: 'Lançamento não encontrado' });
    res.json(item);
  }

  static async listByPaciente(req: Request, res: Response) {
    const pacienteId = Number(req.params.pacienteId);
    if (!Number.isInteger(pacienteId) || pacienteId <= 0) return res.status(400).json({ message: 'id inválido' });

    const items = await repo().find({
      where: { paciente: { id: pacienteId } },
      relations: { consulta: { tipo_consulta: true }, paciente: true },
      order: { created_at: 'DESC' },
    });
    res.json(items);
  }

  static async list(_req: Request, res: Response) {
    const items = await repo().find({
      relations: { paciente: true, consulta: { tipo_consulta: true } },
      order: { created_at: 'DESC' },
    });
    res.json(items);
  }

  static async getByConsulta(req: Request, res: Response) {
    const consultaId = Number(req.params.consultaId);
    if (!Number.isInteger(consultaId) || consultaId <= 0) return res.status(400).json({ message: 'id inválido' });

    const item = await repo().findOne({
      where: { consulta: { id: consultaId }, is_credito: false },
      relations: { paciente: true, consulta: { tipo_consulta: true } },
      order: { created_at: 'DESC' },
    });
    if (!item) return res.status(404).json({ message: 'Nenhum lançamento encontrado para esta consulta' });
    res.json(item);
  }

  // Usa SaldoService - fonte única de verdade
  static async saldoPaciente(req: Request, res: Response) {
    const pacienteId = Number(req.params.pacienteId);
    if (!Number.isInteger(pacienteId) || pacienteId <= 0) return res.status(400).json({ message: 'id inválido' });

    const saldo = await calcularSaldo(AppDataSource.manager, pacienteId);
    res.json({
      saldo_monetario: saldo.saldoMonetario,
      sessoes_pagas: saldo.sessoesPagas,
      sessoes_consumidas: saldo.sessoesConsumidas,
      sessoes_disponiveis: saldo.sessoesDisponiveis,
    });
  }

  static async create(req: Request, res: Response) {
    const body = req.body ?? {};
    const pacienteId = Number(body.paciente_id);
    if (!pacienteId) return res.status(400).json({ message: 'paciente_id obrigatório' });

    // Normaliza/valida campos numéricos vindos do body - evita erros de SQL tipo
    // "invalid input syntax for type integer/numeric" caso cheguem como string
    // inválida, undefined ou NaN (ex: chamadas diretas à API sem passar pelo frontend).
    const valorNum = Number(body.valor ?? 0);
    if (!Number.isFinite(valorNum) || valorNum < 0) {
      return res.status(400).json({ message: 'valor inválido' });
    }
    let sessoesQtyNum: number | null = null;
    if (body.sessoes_qty !== undefined && body.sessoes_qty !== null) {
      sessoesQtyNum = Number(body.sessoes_qty);
      if (!Number.isInteger(sessoesQtyNum) || sessoesQtyNum < 0) {
        return res.status(400).json({ message: 'sessoes_qty inválido' });
      }
    }
    if (body.forma_pgto && !FORMAS_PGTO_VALIDAS.includes(body.forma_pgto)) {
      return res.status(400).json({ message: 'forma_pgto inválida' });
    }
    if (body.tipo_credito && !TIPOS_CREDITO_VALIDOS.includes(body.tipo_credito)) {
      return res.status(400).json({ message: 'tipo_credito inválido' });
    }

    const paciente = await AppDataSource.getRepository(Paciente).findOneBy({ id: pacienteId });
    if (!paciente) return res.status(404).json({ message: 'Paciente não encontrado' });

    let consulta: Consulta | null = null;
    if (body.consulta_id) {
      consulta = await AppDataSource.getRepository(Consulta).findOneBy({ id: Number(body.consulta_id) });

      // Impede dois lançamentos de PAGAMENTO para a mesma consulta (ex: clique duplo
      // no botão "Pagamento" do popup da agenda). Lançamentos de crédito não são afetados.
      if (consulta && !body.is_credito) {
        const existente = await repo().findOne({
          where: { consulta: { id: consulta.id }, is_credito: false },
        });
        if (existente) {
          return res.status(409).json({
            message: 'Já existe um lançamento de pagamento para esta consulta. Edite o lançamento existente em vez de criar um novo.',
            existing_id: existente.id,
          });
        }
      }
    }

    // Débito de crédito dentro de transação - elimina race condition
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const entry = queryRunner.manager.create(ComandaPaciente, {
        paciente,
        consulta,
        valor: valorNum,
        data_pgto: body.data_pgto ?? null,
        forma_pgto: body.forma_pgto ?? null,
        // status_pgto aqui só é relevante para CRÉDITOS (is_credito=true) - para
        // lançamentos de pagamento, aplicarFormaPagamento() abaixo sempre recalcula
        // este campo a partir de forma_pgto/saldo disponível, então o valor inicial
        // é irrelevante nesse caso.
        status_pgto: body.is_credito ? (body.status_pgto ?? null) : null,
        is_credito: body.is_credito ?? false,
        tipo_credito: body.tipo_credito ?? null,
        sessoes_qty: sessoesQtyNum,
        sessoes_consumidas: body.sessoes_consumidas ?? null,
        observacao: body.observacao ?? null,
      });

      await aplicarFormaPagamento(entry as any, queryRunner.manager);
      const saved = await queryRunner.manager.save(entry);
      await queryRunner.commitTransaction();

      const result = await repo().findOne({
        where: { id: saved.id },
        relations: { paciente: true, consulta: { tipo_consulta: true } },
      });
      res.status(201).json(result);
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      if (err?.code === '23505') {
        return res.status(409).json({ message: 'Já existe um lançamento de pagamento para esta consulta.' });
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  static async update(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'id inválido' });

    const entry = await repo().findOne({ where: { id }, relations: { paciente: true } });
    if (!entry) return res.status(404).json({ message: 'Entrada não encontrada' });

    const body = req.body ?? {};

    if (body.valor !== undefined) {
      const valorNum = Number(body.valor);
      if (!Number.isFinite(valorNum) || valorNum < 0) {
        return res.status(400).json({ message: 'valor inválido' });
      }
      body.valor = valorNum;
    }
    if (body.sessoes_qty !== undefined && body.sessoes_qty !== null) {
      const sessoesQtyNum = Number(body.sessoes_qty);
      if (!Number.isInteger(sessoesQtyNum) || sessoesQtyNum < 0) {
        return res.status(400).json({ message: 'sessoes_qty inválido' });
      }
      body.sessoes_qty = sessoesQtyNum;
    }
    if (body.forma_pgto && !FORMAS_PGTO_VALIDAS.includes(body.forma_pgto)) {
      return res.status(400).json({ message: 'forma_pgto inválida' });
    }
    if (body.tipo_credito && !TIPOS_CREDITO_VALIDOS.includes(body.tipo_credito)) {
      return res.status(400).json({ message: 'tipo_credito inválido' });
    }

    const fields: (keyof ComandaPaciente)[] = [
      'valor', 'data_pgto', 'forma_pgto', 'status_pgto',
      'sessoes_qty', 'sessoes_consumidas', 'observacao',
    ];
    fields.forEach((f) => { if (body[f] !== undefined) (entry as any)[f] = body[f]; });

    if (body.consulta_id !== undefined) {
      if (body.consulta_id) {
        const consulta = await AppDataSource.getRepository(Consulta).findOneBy({ id: Number(body.consulta_id) });
        if (!consulta) return res.status(404).json({ message: 'Consulta não encontrada' });
        entry.consulta = consulta;
      } else {
        entry.consulta = null;
      }
    }

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await aplicarFormaPagamento(entry as any, queryRunner.manager, entry.id);
      const saved = await queryRunner.manager.save(entry);
      await queryRunner.commitTransaction();

      const result = await repo().findOne({
        where: { id: saved.id },
        relations: { paciente: true, consulta: { tipo_consulta: true } },
      });
      res.json(result);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  static async remove(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'id inválido' });

    const result = await repo().delete(id);
    if (!result.affected) return res.status(404).json({ message: 'Entrada não encontrada' });
    res.status(204).send();
  }

  static async inadimplentes(_req: Request, res: Response) {
    const pendentes = await repo().find({
      where: { is_credito: false, status_pgto: 'pendente' },
      relations: { paciente: true, consulta: { tipo_consulta: true } },
      order: { created_at: 'DESC' },
    });

    const map = new Map<number, {
      paciente: Paciente;
      total_em_aberto: number;
      lancamentos: typeof pendentes;
    }>();

    for (const item of pendentes) {
      if (!item.paciente) continue;
      const pid = item.paciente.id;
      if (!map.has(pid)) map.set(pid, { paciente: item.paciente, total_em_aberto: 0, lancamentos: [] });
      const e = map.get(pid)!;
      e.total_em_aberto = Number((e.total_em_aberto + Number(item.valor)).toFixed(2));
      e.lancamentos.push(item);
    }

    // Remove pacientes cujo saldo de crédito (monetário + sessões) cobre
    // integralmente a dívida - eles têm crédito disponível para quitar.
    const resultado: typeof map extends Map<any, infer V> ? V[] : never[] = [];
    for (const entry of map.values()) {
      const { saldoMonetario, sessoesDisponiveis } = await calcularSaldo(
        AppDataSource.manager,
        entry.paciente.id,
      );

      // Desconta do total em aberto o que pode ser coberto por crédito disponível
      const cobertoMonetario = Math.min(saldoMonetario, entry.total_em_aberto);
      const totalAposMonetario = Number((entry.total_em_aberto - cobertoMonetario).toFixed(2));

      // Cada sessão disponível pode cobrir um lançamento com forma_pgto nula
      const lancamentosSemCredito = entry.lancamentos.filter(
        l => l.forma_pgto === null || l.forma_pgto === undefined,
      );
      const valorCobertoPorSessoes = lancamentosSemCredito
        .slice(0, sessoesDisponiveis)
        .reduce((acc, l) => acc + Number(l.valor), 0);

      const totalReal = Number((totalAposMonetario - valorCobertoPorSessoes).toFixed(2));

      // Só inclui no relatório se realmente há saldo devedor não coberto por crédito
      if (totalReal > 0) {
        resultado.push({ ...entry, total_em_aberto: totalReal });
      }
    }

    res.json(resultado.sort((a, b) => b.total_em_aberto - a.total_em_aberto));
  }
}