import { config } from '../config/env.js';
import { requireStripe } from '../lib/stripe.js';
import { logger } from '../lib/logger.js';
import { handleStripeEvent } from '../services/stripeWebhookService.js';

export async function handleStripeWebhook(req, res) {
  const stripe = requireStripe();

  if (!config.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET is not configured' });
  }

  const signature = req.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err: err.message }, 'Rejected Stripe webhook with invalid signature');
    return res.status(400).json({ error: 'Webhook signature verification failed: ' + err.message });
  }

  const result = await handleStripeEvent(event);

  const response = { received: true, status: result.status };
  if (result.paymentId !== undefined) {
    response.paymentId = result.paymentId;
  }
  if (result.subscriptionId !== undefined) {
    response.subscriptionId = result.subscriptionId;
  }
  if (result.userId !== undefined) {
    response.userId = result.userId;
  }
  res.json(response);
}
