import 'reflect-metadata';
import app from './app';
import { AppDataSource } from '@config/data-source';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

async function start() {
  try {
    await AppDataSource.initialize();
    console.log('Banco de dados conectado!');
    app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
  } catch (err) {
    console.error('Falha ao conectar no banco:', err);
    process.exit(1);
  }
}

start();
