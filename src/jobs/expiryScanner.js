import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/env.js';
import { enqueuePaymentConfirmation, enqueueRenewalReminder } from '../queues/index.js';
import { findPaymentsMissingConfirmation } from '../services/invoiceService.js';
import { invalidateMetricsCache } from '../services/metricsService.js';
import { getExpiringSubscriptionsWithoutReminder, expireLapsedSubscriptions } from '../models/subscriptionModel.js';

const LOCK_KEY = 'lock:expiry-scan';
const LOCK_SECONDS = 300;

async function takeLock(lockValue) {
  const result = await redis.set(LOCK_KEY, lockValue, 'EX', LOCK_SECONDS, 'NX');
  return result === 'OK';
}

async function releaseLock(lockValue) {
  const currentValue = await redis.get(LOCK_KEY);
  if (currentValue === lockValue) {
    await redis.del(LOCK_KEY);
  }
}

export async function runExpiryScan(options = {}) {
  let days = config.REMINDER_DAYS_BEFORE_EXPIRY;
  if (options.days) {
    days = options.days;
  }

  const lockValue = process.pid + ':' + Date.now();
  const gotLock = await takeLock(lockValue);
  if (!gotLock) {
    logger.info('Expiry scan already running elsewhere; skipping');
    return { skipped: true };
  }

  try {
    const expiringSubscriptions = await getExpiringSubscriptionsWithoutReminder(days);
    for (const subscription of expiringSubscriptions) {
      await enqueueRenewalReminder(subscription.id, subscription.current_period_end);
    }

    const expiredCount = await expireLapsedSubscriptions();
    if (expiredCount > 0) {
      await invalidateMetricsCache();
    }

    const missingPayments = await findPaymentsMissingConfirmation();
    for (const paymentId of missingPayments) {
      await enqueuePaymentConfirmation(paymentId);
    }

    const summary = {
      days: days,
      remindersQueued: expiringSubscriptions.length,
      expired: expiredCount,
      confirmationsRequeued: missingPayments.length,
    };
    logger.info(summary, 'Expiry scan finished');
    return summary;
  } finally {
    await releaseLock(lockValue);
  }
}
