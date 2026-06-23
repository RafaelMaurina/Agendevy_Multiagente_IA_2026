import { NextFunction, Request, Response } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err.status ?? err.statusCode ?? 500;
  const message = err.message || 'Erro interno no servidor';

  console.error(`[errorHandler] ${status} -`, err);

  res.status(status).json({
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
