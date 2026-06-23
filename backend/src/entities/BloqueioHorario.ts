import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { Profissional } from './Profissional';

@Entity({ name: 'bloqueio_horario' })
export class BloqueioHorario {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Profissional, { nullable: true, onDelete: 'SET NULL' })
  profissional!: Profissional | null;

  @Column({ type: 'timestamptz' })
  inicio!: Date;

  @Column({ type: 'timestamptz' })
  fim!: Date;

  @Column({ type: 'text', nullable: true })
  motivo!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}
