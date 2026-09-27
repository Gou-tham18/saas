import express, { Router } from 'express';
import { handleStripeWebhook } from '../controllers/webhookController.js';

export const webhookRouter = Router();

const rawJsonBody = express.raw({ type: 'application/json', limit: '1mb' });

webhookRouter.post('/stripe', rawJsonBody, handleStripeWebhook);
