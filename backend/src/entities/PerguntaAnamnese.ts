import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn } from 'typeorm';
import { RespostaAnamnese } from './RespostaAnamnese';

export type TipoPergunta = 'sim_nao' | 'texto';

@Entity({ name: 'perguntas_anamnese' })
export class PerguntaAnamnese {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  texto!: string;

  @Column({ type: 'text', default: 'sim_nao' })
  tipo!: TipoPergunta;

  @Column({ type: 'boolean', default: true })
  ativo!: boolean;

  @Column({ type: 'int', default: 0 })
  ordem!: number;

  @OneToMany(() => RespostaAnamnese, (r) => r.pergunta)
  respostas!: RespostaAnamnese[];

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}
