import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import routes from '@routes/index';
import { errorHandler } from '@middlewares/errorHandler';

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
  }),
);

app.use(express.json());

// Rate limiting global: 200 req / 1 min por IP
// Ajuste os valores conforme o volume esperado da clínica.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas requisições. Tente novamente em instantes.' },
});
app.use('/api', limiter);

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use('/api', routes);
app.use(errorHandler);

export default app;
