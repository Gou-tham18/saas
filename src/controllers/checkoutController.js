import { z } from 'zod';
import { parse } from '../middleware/index.js';
import { HttpError } from '../lib/httpError.js';
import { createCheckoutSession } from '../services/checkoutService.js';
import { getPlanByCode, listActivePlans } from '../services/subscriptionService.js';

const checkoutSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(120).optional(),
  planCode: z.string().min(1),
});

export async function listPlans(req, res) {
  const plans = await listActivePlans();
  res.json({ plans: plans });
}

export async function createSession(req, res) {
  const body = parse(checkoutSchema, req.body);

  const plan = await getPlanByCode(body.planCode);
  if (!plan) {
    throw new HttpError(404, 'Unknown plan: ' + body.planCode);
  }

  const session = await createCheckoutSession({ email: body.email, name: body.name, plan: plan });
  res.status(201).json(session);
}

export function checkoutSuccess(req, res) {
  let sessionId = null;
  if (req.query.session_id) {
    sessionId = req.query.session_id;
  }

  res.json({
    message: 'Payment submitted. Your subscription is activated once Stripe confirms it via webhook; a confirmation email with your invoice follows.',
    sessionId: sessionId,
  });
}

export function checkoutCancel(req, res) {
  res.json({ message: 'Checkout cancelled. No payment was taken.' });
}
