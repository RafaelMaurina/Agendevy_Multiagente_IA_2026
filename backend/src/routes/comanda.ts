import { Router } from 'express';
import { ComandaController } from '@controllers/ComandaController';
import { asyncHandler } from '@middlewares/asyncHandler';

const router = Router();

router.get('/', asyncHandler(ComandaController.list));
router.get('/inadimplentes', asyncHandler(ComandaController.inadimplentes));
router.post('/', asyncHandler(ComandaController.create));
router.put('/:id', asyncHandler(ComandaController.update));
router.delete('/:id', asyncHandler(ComandaController.remove));

router.get('/paciente/:pacienteId', asyncHandler(ComandaController.listByPaciente));
router.get('/paciente/:pacienteId/saldo', asyncHandler(ComandaController.saldoPaciente));

router.get('/consulta/:consultaId', asyncHandler(ComandaController.getByConsulta));
router.get('/:id', asyncHandler(ComandaController.getById));

export default router;
