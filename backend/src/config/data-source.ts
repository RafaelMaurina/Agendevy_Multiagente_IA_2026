import { DataSource } from 'typeorm';
import dotenv from 'dotenv';

import { Paciente } from '../entities/Paciente';
import { Profissional } from '../entities/Profissional';
import { Consulta } from '../entities/Consulta';
import { Agendamento } from '../entities/Agendamento';
import { ConsultaAgenda } from '../entities/ConsultaAgenda';
import { TipoConsulta } from '../entities/TipoConsulta';
import { ComandaPaciente } from '../entities/ComandaPaciente';
import { PerguntaAnamnese } from '../entities/PerguntaAnamnese';
import { RespostaAnamnese } from '../entities/RespostaAnamnese';
import { BloqueioHorario } from '../entities/BloqueioHorario';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: process.env.NODE_ENV !== 'production',
  logging: false,
  entities: [
    Paciente,
    Profissional,
    Consulta,
    Agendamento,
    ConsultaAgenda,
    TipoConsulta,
    ComandaPaciente,
    PerguntaAnamnese,
    RespostaAnamnese,
    BloqueioHorario,
  ],
  migrations: ['src/migrations/*.ts'],
});
