import crypto from 'node:crypto';
import { withTransaction } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { enqueuePaymentConfirmation } from '../queues/index.js';
import { applySuccessfulPayment } from './subscriptionService.js';
import { invalidateMetricsCache } from './metricsService.js';

export async function afterPaymentCommitted(paymentId) {
  await invalidateMetricsCache();

  if (!paymentId) {
    return;
  }

  try {
    await enqueuePaymentConfirmation(paymentId);
  } catch (err) {
    logger.error({ err, paymentId }, 'Failed to enqueue payment confirmation; sweeper will retry');
  }
}

function addBillingPeriod(startDate, interval) {
  const endDate = new Date(startDate);
  if (interval === 'year') {
    endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
  } else {
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  }
  return endDate;
}

export async function simulateSuccessfulPayment({ email, name, plan, periodDays }) {
  const now = new Date();

  let periodEnd;
  if (periodDays) {
    periodEnd = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
  } else {
    periodEnd = addBillingPeriod(now, plan.interval);
  }

  const paymentData = {
    user: { email: email, name: name },
    subscription: {
      planId: plan.id,
      status: 'active',
      periodStart: now,
      periodEnd: periodEnd,
    },
    payment: {
      provider: 'simulated',
      externalRef: 'sim_' + crypto.randomUUID(),
      amountCents: plan.amount_cents,
      currency: plan.currency,
      paidAt: now,
    },
  };

  const result = await withTransaction(async (client) => {
    return await applySuccessfulPayment(client, paymentData);
  });

  await afterPaymentCommitted(result.paymentId);
  return result;
}
