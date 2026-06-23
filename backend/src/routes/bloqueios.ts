import { Router } from 'express';
import { BloqueioHorarioController } from '@controllers/BloqueioHorarioController';
import { asyncHandler } from '@middlewares/asyncHandler';

const router = Router();

router.get('/', asyncHandler(BloqueioHorarioController.list));
router.post('/', asyncHandler(BloqueioHorarioController.create));
router.delete('/:id', asyncHandler(BloqueioHorarioController.remove));

export default router;
