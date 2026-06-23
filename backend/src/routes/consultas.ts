import { Router } from 'express';
import { ConsultaController } from '@controllers/ConsultaController';
import { asyncHandler } from '@middlewares/asyncHandler';

const router = Router();

router.get('/', asyncHandler(ConsultaController.list));
router.post('/sync-agendas', asyncHandler(ConsultaController.syncAllAgendas));
router.post('/', asyncHandler(ConsultaController.create));
router.get('/:id', asyncHandler(ConsultaController.get));
router.put('/:id', asyncHandler(ConsultaController.update));
router.delete('/:id', asyncHandler(ConsultaController.remove));

export default router;
