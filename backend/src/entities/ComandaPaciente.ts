import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, Index, Unique } from 'typeorm';
import { Paciente } from './Paciente';
import { Consulta } from './Consulta';

export type FormaPagamento = 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix' | 'credito_sessoes' | 'credito_saldo';
export type TipoCredito = 'monetario' | 'sessoes';
export type StatusPgto = 'pago' | 'pendente';

@Entity({ name: 'comanda_paciente' })
export class ComandaPaciente {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @ManyToOne(() => Paciente, { onDelete: 'CASCADE' })
  paciente!: Paciente;

  // Apenas UM lançamento de pagamento (is_credito=false) pode existir por consulta.
  // Lançamentos de crédito (is_credito=true) não têm consulta vinculada, então o
  // índice não os afeta. A constraint é reforçada também na aplicação (create()).
  @Index('uq_comanda_consulta_pagamento', { unique: true, where: '"is_credito" = false AND "consultaId" IS NOT NULL' })
  @ManyToOne(() => Consulta, { nullable: true, onDelete: 'SET NULL' })
  consulta!: Consulta | null;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  valor!: number;

  @Column({ type: 'date', nullable: true })
  data_pgto!: string | null;

  @Column({ type: 'text', nullable: true })
  forma_pgto!: FormaPagamento | null;

  // Status do pagamento de uma consulta: 'pago' (descontou crédito ou foi pago)
  // ou 'pendente' (em aberto, sem crédito suficiente ou ainda não pago).
  // Não se aplica a lançamentos de crédito (is_credito = true).
  @Column({ type: 'text', nullable: true })
  status_pgto!: StatusPgto | null;

  // Crédito: pode ser adicionado manualmente (sem consulta) para ser consumido depois
  @Column({ type: 'boolean', default: false })
  is_credito!: boolean;

  // Tipo do crédito: monetario (R$) ou sessoes (qtd)
  @Column({ type: 'text', nullable: true })
  tipo_credito!: TipoCredito | null;

  // Quantidade de sessões (quando tipo_credito = 'sessoes')
  @Column({ type: 'int', nullable: true })
  sessoes_qty!: number | null;

  // Sessões consumidas (desconta do saldo)
  @Column({ type: 'int', nullable: true })
  sessoes_consumidas!: number | null;

  @Column({ type: 'text', nullable: true })
  observacao!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}
