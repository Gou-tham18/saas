import { logger } from '../lib/logger.js';
import { JOBS } from '../queues/index.js';
import { ACTIVE_STATUSES, getSubscriptionForReminder } from '../models/subscriptionModel.js';
import { isReminderSent, saveReminder } from '../models/reminderModel.js';
import { createInvoiceForPayment, getPaymentContext, markInvoiceEmailed } from '../services/invoiceService.js';
import { sendPaymentConfirmationEmail, sendRenewalReminderEmail } from '../services/emailService.js';

async function processPaymentConfirmation(jobData) {
  const paymentId = jobData.paymentId;

  const payment = await getPaymentContext(paymentId);
  if (!payment) {
    return { skipped: 'payment not found' };
  }

  const invoice = await createInvoiceForPayment(paymentId);
  if (invoice.emailed_at) {
    return { skipped: 'already emailed', invoice: invoice.invoice_number };
  }

  const email = await sendPaymentConfirmationEmail(payment, invoice);
  await markInvoiceEmailed(invoice.id);

  return { invoice: invoice.invoice_number, messageId: email.messageId, previewUrl: email.previewUrl };
}

async function processRenewalReminder(jobData) {
  const subscriptionId = jobData.subscriptionId;
  const periodEnd = new Date(jobData.periodEnd);

  const subscription = await getSubscriptionForReminder(subscriptionId);
  if (!subscription) {
    return { skipped: 'no longer active' };
  }
  if (!ACTIVE_STATUSES.includes(subscription.status)) {
    return { skipped: 'no longer active' };
  }
  if (subscription.current_period_end.getTime() !== periodEnd.getTime()) {
    return { skipped: 'period changed' };
  }

  const alreadySent = await isReminderSent(subscriptionId, subscription.current_period_end);
  if (alreadySent) {
    return { skipped: 'already reminded' };
  }

  const email = await sendRenewalReminderEmail(subscription);
  await saveReminder(subscriptionId, subscription.current_period_end);

  return { messageId: email.messageId, previewUrl: email.previewUrl };
}

export async function processNotificationJob(job) {
  let result;

  if (job.name === JOBS.PAYMENT_CONFIRMATION) {
    result = await processPaymentConfirmation(job.data);
  } else if (job.name === JOBS.RENEWAL_REMINDER) {
    result = await processRenewalReminder(job.data);
  } else {
    throw new Error('Unknown job type: ' + job.name);
  }

  logger.info({ jobId: job.id, job: job.name, result: result }, 'Job completed');
  return result;
}
