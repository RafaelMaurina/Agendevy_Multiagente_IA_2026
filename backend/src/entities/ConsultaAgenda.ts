import { Entity, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, Index } from 'typeorm';
import { Agendamento } from './Agendamento'; 
import { Consulta } from './Consulta';       

@Entity({ name: 'consultas_agenda' })
export class ConsultaAgenda {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Agendamento, (agenda) => agenda.consultas, { onDelete: 'CASCADE' })
  @Index()
  agenda!: Agendamento;

  @ManyToOne(() => Consulta, { onDelete: 'CASCADE' })
  @Index()
  consulta!: Consulta;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  added_at!: Date;
}
