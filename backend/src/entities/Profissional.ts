import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, Index } from 'typeorm';
import { Consulta } from './Consulta';
import { Agendamento } from './Agendamento';

@Entity({ name: 'profissionais' })
export class Profissional {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'text' })
  nome!: string;

  @Column({ type: 'text' })
  especialidade!: string;

  // Registro em conselho profissional (CREFITO, CREA, CRBIO, CRM, etc.). Opcional - nem todo
  // profissional tem, ou pode ser cadastrado depois.
  @Column({ type: 'text', nullable: true })
  registro_conselho!: string | null;

  @Column({ type: 'text', nullable: true })
  registro_numero!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;

  @OneToMany(() => Consulta, (consulta) => consulta.profissional)
  consultas!: Consulta[];

  @OneToMany(() => Agendamento, (agenda) => agenda.profissional)
  agendas!: Agendamento[];
}
