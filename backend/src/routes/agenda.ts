import { Router } from 'express';
import { AgendamentoController } from '@controllers/AgendamentoController';
import { asyncHandler } from '@middlewares/asyncHandler';

const router = Router();

router.get('/', asyncHandler(AgendamentoController.list));
router.post('/', asyncHandler(AgendamentoController.create));
router.get('/:id', asyncHandler(AgendamentoController.get));
router.put('/:id', asyncHandler(AgendamentoController.update));
router.delete('/:id', asyncHandler(AgendamentoController.remove));

router.post('/:id/consultas', asyncHandler(AgendamentoController.addConsulta));
router.get('/:id/consultas', asyncHandler(AgendamentoController.listConsultas));
router.delete('/:id/consultas/:consultaId', asyncHandler(AgendamentoController.removeConsulta));

export default router;
