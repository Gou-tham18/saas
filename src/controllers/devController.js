import { z } from 'zod';
import { parse } from '../middleware/index.js';
import { HttpError } from '../lib/httpError.js';
import { getPlanByCode } from '../services/subscriptionService.js';
import { simulateSuccessfulPayment } from '../services/paymentService.js';
import { runExpiryScan } from '../jobs/expiryScanner.js';

const simulatePaymentSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(120).optional(),
  planCode: z.string().min(1),
  periodDays: z.number().int().min(1).max(730).optional(),
});

const expiryScanSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
});

export async function simulatePayment(req, res) {
  const body = parse(simulatePaymentSchema, req.body);

  const plan = await getPlanByCode(body.planCode);
  if (!plan) {
    throw new HttpError(404, 'Unknown plan: ' + body.planCode);
  }

  const result = await simulateSuccessfulPayment({
    email: body.email,
    name: body.name,
    plan: plan,
    periodDays: body.periodDays,
  });

  res.status(201).json({
    user: result.user,
    subscription: result.subscription,
    paymentId: result.paymentId,
    note: 'Invoice + confirmation email are being processed by the worker.',
  });
}

export async function triggerExpiryScan(req, res) {
  let requestBody = req.body;
  if (!requestBody) {
    requestBody = {};
  }
  const body = parse(expiryScanSchema, requestBody);

  const options = {};
  if (body.days) {
    options.days = body.days;
  }

  const summary = await runExpiryScan(options);
  res.json(summary);
}
