import { Router } from 'express';
import { AnamneseController } from '@controllers/AnamneseController';
import { asyncHandler } from '@middlewares/asyncHandler';

const router = Router();

router.get('/perguntas', asyncHandler(AnamneseController.listPerguntas));
router.post('/perguntas', asyncHandler(AnamneseController.createPergunta));
router.put('/perguntas/:id', asyncHandler(AnamneseController.updatePergunta));
router.delete('/perguntas/:id', asyncHandler(AnamneseController.removePergunta));

router.get('/paciente/:pacienteId', asyncHandler(AnamneseController.getRespostasPaciente));
router.post('/paciente/:pacienteId', asyncHandler(AnamneseController.saveRespostasPaciente));

export default router;
