/**
 * Fuso horário fixo do Agendevy: -03:00 (América/São Paulo), sem horário de verão (abolido no
 * Brasil desde 2019). Usado em qualquer lugar que precise exibir ou calcular uma data/hora
 * "local" de forma determinística - NUNCA depender de `Date.getHours()`/`getDate()`/etc.
 * direto, porque esses acessores usam o fuso configurado no sistema operacional de quem está
 * rodando o processo Node, não necessariamente -03:00.
 *
 * Truque usado: deslocamos o timestamp UTC por -180 minutos e lemos com os acessores
 * `getUTC*()` do resultado - isso dá o "relógio de parede" de -03:00 independente de
 * qualquer configuração de fuso do SO ou do `TZ` do processo.
 */

const OFFSET_MINUTOS_FUSO_PADRAO = -180; // -03:00

/** Desloca uma Date para que seus acessores getUTC*() leiam o horário de -03:00. */
export function paraFusoLocal(data: Date): Date {
  return new Date(data.getTime() + OFFSET_MINUTOS_FUSO_PADRAO * 60000);
}

/** "Agora", já no fuso fixo -03:00 (use com os acessores getUTC*() no resultado). */
export function agoraFusoLocal(): Date {
  return paraFusoLocal(new Date());
}

/** Formata uma Date como "HH:MM" (24h) em -03:00 fixo, independente do fuso do sistema. */
export function fmtHHMMFusoLocal(data: Date): string {
  const d = paraFusoLocal(data);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" do dia atual em -03:00 fixo, independente do fuso do sistema. */
export function hojeFusoLocal(): string {
  const d = agoraFusoLocal();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
