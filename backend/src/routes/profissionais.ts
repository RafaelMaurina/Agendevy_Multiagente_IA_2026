import { Router } from 'express';
import { ProfissionalController } from '@controllers/ProfissionalController';
import { asyncHandler } from '@middlewares/asyncHandler';

const router = Router();

router.get('/', asyncHandler(ProfissionalController.list));
router.post('/', asyncHandler(ProfissionalController.create));
router.get('/:id', asyncHandler(ProfissionalController.get));
router.put('/:id', asyncHandler(ProfissionalController.update));
router.delete('/:id', asyncHandler(ProfissionalController.remove));

export default router;
