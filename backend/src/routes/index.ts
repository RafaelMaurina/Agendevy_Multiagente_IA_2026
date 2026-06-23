import { Router } from 'express';

import pacientesRouter from '@routes/pacientes';
import profissionaisRouter from '@routes/profissionais';
import consultasRouter from '@routes/consultas';
import agendasRouter from '@routes/agenda';
import tiposConsultaRouter from '@routes/tipos-consulta';
import comandaRouter from '@routes/comanda';
import anamneseRouter from '@routes/anamnese';
import bloqueiosRouter from '@routes/bloqueios';

const router = Router();

router.use('/pacientes', pacientesRouter);
router.use('/profissionais', profissionaisRouter);
router.use('/consultas', consultasRouter);
router.use('/agendas', agendasRouter);
router.use('/tipos-consulta', tiposConsultaRouter);
router.use('/comanda', comandaRouter);
router.use('/anamnese', anamneseRouter);
router.use('/bloqueios', bloqueiosRouter);

export default router;
