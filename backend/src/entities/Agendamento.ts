import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, CreateDateColumn, Index } from 'typeorm';
import { Profissional } from './Profissional';
import { ConsultaAgenda } from './ConsultaAgenda';

@Entity({ name: 'agendamentos' })
export class Agendamento {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'text' })
  nome!: string;

  @ManyToOne(() => Profissional, (p) => p.agendas, { onDelete: 'CASCADE' })
  profissional!: Profissional;

  @OneToMany(() => ConsultaAgenda, (rel) => rel.agenda)
  consultas!: ConsultaAgenda[];

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}
