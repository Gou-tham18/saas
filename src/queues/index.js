import { Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';

export const NOTIFICATIONS_QUEUE = 'notifications';

export const JOBS = {
  PAYMENT_CONFIRMATION: 'payment-confirmation',
  RENEWAL_REMINDER: 'renewal-reminder',
};

const ONE_DAY_SECONDS = 24 * 60 * 60;

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: ONE_DAY_SECONDS, count: 1000 },
  removeOnFail: { age: 7 * ONE_DAY_SECONDS },
};

let queue = null;
let queueConnection = null;

export function getNotificationsQueue() {
  if (!queue) {
    queueConnection = createRedisConnection({ forBullMQ: true, name: 'queue' });
    queue = new Queue(NOTIFICATIONS_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: defaultJobOptions,
    });
  }
  return queue;
}

export async function enqueuePaymentConfirmation(paymentId) {
  const jobId = 'payment-' + paymentId;
  return await getNotificationsQueue().add(JOBS.PAYMENT_CONFIRMATION, { paymentId: paymentId }, { jobId: jobId });
}

export async function enqueueRenewalReminder(subscriptionId, periodEnd) {
  const periodEndDate = new Date(periodEnd);
  const jobId = 'renewal-' + subscriptionId + '-' + periodEndDate.getTime();
  const jobData = { subscriptionId: subscriptionId, periodEnd: periodEndDate.toISOString() };
  return await getNotificationsQueue().add(JOBS.RENEWAL_REMINDER, jobData, { jobId: jobId });
}

export async function closeQueue() {
  if (!queue) {
    return;
  }
  await queue.close();
  await queueConnection.quit();
  queue = null;
  queueConnection = null;
}
