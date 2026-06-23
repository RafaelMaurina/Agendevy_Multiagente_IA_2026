import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index } from 'typeorm';
import { Paciente } from './Paciente';
import { PerguntaAnamnese } from './PerguntaAnamnese';

@Entity({ name: 'respostas_anamnese' })
export class RespostaAnamnese {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @ManyToOne(() => Paciente, { onDelete: 'CASCADE' })
  paciente!: Paciente;

  @ManyToOne(() => PerguntaAnamnese, (p) => p.respostas, { onDelete: 'CASCADE' })
  pergunta!: PerguntaAnamnese;

  @Column({ type: 'text', nullable: true })
  resposta!: string | null; // 'sim' | 'nao' | texto livre
}
