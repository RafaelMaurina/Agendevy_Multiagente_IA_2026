import { EntityManager } from 'typeorm';
import { ComandaPaciente } from '@entities/ComandaPaciente';

export interface Saldo {
  saldoMonetario: number;
  sessoesDisponiveis: number;
  sessoesPagas: number;
  sessoesConsumidas: number;
}

/**
 * Calcula o saldo de crédito (monetário e sessões) de um paciente.
 *
 * Recebe um `EntityManager` para poder ser chamado tanto fora quanto dentro
 * de uma transação (queryRunner.manager). Isso garante que leituras feitas
 * dentro de uma transação enxerguem apenas os dados confirmados até ali,
 * eliminando a race condition de débito simultâneo de crédito.
 *
 * @param manager   EntityManager ou manager de um queryRunner ativo.
 * @param pacienteId  ID do paciente.
 * @param excludeId  ID de um lançamento a ignorar no cálculo (usado ao editar).
 */
export async function calcularSaldo(
  manager: EntityManager,
  pacienteId: number,
  excludeId?: number,
): Promise<Saldo> {
  let items = await manager.find(ComandaPaciente, {
    where: { paciente: { id: pacienteId } },
  });

  if (excludeId) items = items.filter((i) => i.id !== excludeId);

  const saldoMonetario = items.reduce((acc, i) => {
    if (i.is_credito && i.tipo_credito === 'monetario') return acc + Number(i.valor);
    if (!i.is_credito && i.forma_pgto === 'credito_saldo' && i.status_pgto !== 'pendente')
      return acc - Number(i.valor);
    return acc;
  }, 0);

  const sessoesPagas = items
    .filter((i) => i.is_credito && i.tipo_credito === 'sessoes')
    .reduce((acc, i) => acc + (i.sessoes_qty ?? 0), 0);

  // sessoes_consumidas é gravado nos lançamentos de PAGAMENTO (is_credito = false)
  // quando a consulta é paga via crédito de sessões - não nos lançamentos de crédito.
  const sessoesConsumidas = items
    .filter((i) => !i.is_credito && i.forma_pgto === 'credito_sessoes' && i.status_pgto !== 'pendente')
    .reduce((acc, i) => acc + (i.sessoes_consumidas ?? 0), 0);

  return {
    saldoMonetario: Number(saldoMonetario.toFixed(2)),
    sessoesDisponiveis: sessoesPagas - sessoesConsumidas,
    sessoesPagas,
    sessoesConsumidas,
  };
}
