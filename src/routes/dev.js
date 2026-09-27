import { Router } from 'express';
import { simulatePayment, triggerExpiryScan } from '../controllers/devController.js';

export const devRouter = Router();

devRouter.post('/simulate-payment', simulatePayment);
devRouter.post('/run-expiry-scan', triggerExpiryScan);
