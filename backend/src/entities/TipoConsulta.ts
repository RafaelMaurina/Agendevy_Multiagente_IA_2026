import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn } from 'typeorm';
import { Consulta } from './Consulta';

@Entity({ name: 'tipos_consulta' })
export class TipoConsulta {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  nome!: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  valor_padrao!: number | null;

  @Column({ type: 'integer', default: 30 })
  duracao_minutos!: number;

  @OneToMany(() => Consulta, (c) => c.tipo_consulta)
  consultas!: Consulta[];

  @CreateDateColumn({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date;
}
