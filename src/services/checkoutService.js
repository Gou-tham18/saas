import { requireStripe } from '../lib/stripe.js';
import { config } from '../config/env.js';
import { findStripeCustomerId } from '../models/userModel.js';

export async function createCheckoutSession({ email, name, plan }) {
  const stripe = requireStripe();

  const sessionData = {
    mode: 'subscription',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: plan.currency,
          unit_amount: plan.amount_cents,
          recurring: { interval: plan.interval },
          product_data: {
            name: plan.name + ' plan',
            metadata: { plan_code: plan.code },
          },
        },
      },
    ],
    subscription_data: {
      metadata: {
        plan_id: String(plan.id),
        plan_code: plan.code,
        customer_name: name || '',
      },
    },
    metadata: { plan_id: String(plan.id) },
    success_url: config.checkoutSuccessUrl,
    cancel_url: config.checkoutCancelUrl,
  };

  const existingCustomerId = await findStripeCustomerId(email);
  if (existingCustomerId) {
    sessionData.customer = existingCustomerId;
  } else {
    sessionData.customer_email = email;
  }

  const session = await stripe.checkout.sessions.create(sessionData);

  return { sessionId: session.id, url: session.url };
}
