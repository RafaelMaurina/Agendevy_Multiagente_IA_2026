import { Request, Response, NextFunction } from 'express';

/**
 * Envolve um handler assíncrono e garante que qualquer rejeição de Promise
 * seja encaminhada para o errorHandler do Express via `next(err)`.
 *
 * Uso:
 *   router.get('/rota', asyncHandler(async (req, res) => { ... }));
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);
