import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, Index } from 'typeorm';
import { Consulta } from './Consulta';

@Entity({ name: 'pacientes' })
export class Paciente {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'text' })
  nome!: string;

  @Column({ type: 'text', nullable: true })
  telefone!: string;

  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ type: 'date', nullable: true })
  data_nascimento!: string | null;

  @Column({ type: 'text', nullable: true })
  observacoes!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;

  @OneToMany(() => Consulta, (consulta) => consulta.paciente)
  consultas!: Consulta[];
}
