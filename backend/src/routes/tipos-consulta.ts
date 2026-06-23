import { Router } from 'express';
import { TipoConsultaController } from '@controllers/TipoConsultaController';
import { asyncHandler } from '@middlewares/asyncHandler';

const router = Router();

router.get('/', asyncHandler(TipoConsultaController.list));
router.post('/', asyncHandler(TipoConsultaController.create));
router.get('/:id', asyncHandler(TipoConsultaController.get));
router.put('/:id', asyncHandler(TipoConsultaController.update));
router.delete('/:id', asyncHandler(TipoConsultaController.remove));

export default router;
