import { Router } from 'express';
import { PacienteController } from '@controllers/PacienteController';
import { asyncHandler } from '@middlewares/asyncHandler';

const router = Router();

router.get('/', asyncHandler(PacienteController.list));
router.post('/', asyncHandler(PacienteController.create));
router.get('/:id', asyncHandler(PacienteController.get));
router.put('/:id', asyncHandler(PacienteController.update));
router.delete('/:id', asyncHandler(PacienteController.remove));

export default router;
