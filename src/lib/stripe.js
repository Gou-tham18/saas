import Stripe from 'stripe';
import { config } from '../config/env.js';

let stripeClient = null;

if (config.stripeEnabled) {
  if (!config.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    throw new Error('Only Stripe test-mode keys (sk_test_...) are allowed for this project');
  }
  stripeClient = new Stripe(config.STRIPE_SECRET_KEY);
}

export const stripe = stripeClient;

export function requireStripe() {
  if (!stripe) {
    const err = new Error('Stripe is not configured. Set STRIPE_SECRET_KEY (test mode) in .env');
    err.status = 503;
    throw err;
  }
  return stripe;
}
