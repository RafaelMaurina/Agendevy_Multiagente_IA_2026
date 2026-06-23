import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, Index } from 'typeorm';
import { Paciente } from './Paciente';
import { Profissional } from './Profissional';
import { TipoConsulta } from './TipoConsulta';

@Entity({ name: 'consultas' })
@Index('uq_consulta_profissional_horario', ['profissional', 'data_hora'], { unique: true })
export class Consulta {
  @PrimaryGeneratedColumn()
  id!: number;

  // Mantido para compatibilidade, mas agora preenchido automaticamente pelo tipo_consulta se vazio
  @Column({ type: 'text', nullable: true })
  nome_consulta!: string | null;

  @ManyToOne(() => TipoConsulta, (t) => t.consultas, { nullable: true, onDelete: 'SET NULL', eager: false })
  tipo_consulta!: TipoConsulta | null;

  @Column({ type: 'timestamptz' })
  data_hora!: Date;

  // Calculado automaticamente na criação/edição: data_hora + tipo_consulta.duracao_minutos
  @Column({ type: 'timestamptz', nullable: true })
  horario_fim!: Date | null;

  @Column({ type: 'text', default: 'aberta' })
  status!: string;

  @ManyToOne(() => Paciente, (p) => p.consultas, { onDelete: 'CASCADE' })
  paciente!: Paciente;

  @ManyToOne(() => Profissional, (p) => p.consultas, { onDelete: 'CASCADE' })
  profissional!: Profissional;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}
