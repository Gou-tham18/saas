import { Router } from 'express';
import { checkoutCancel, checkoutSuccess, createSession, listPlans } from '../controllers/checkoutController.js';

export const checkoutRouter = Router();

checkoutRouter.get('/plans', listPlans);
checkoutRouter.post('/checkout/session', createSession);
checkoutRouter.get('/checkout/success', checkoutSuccess);
checkoutRouter.get('/checkout/cancel', checkoutCancel);
