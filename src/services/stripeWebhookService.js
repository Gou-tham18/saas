import { withTransaction } from '../db/pool.js';
import { requireStripe } from '../lib/stripe.js';
import { logger } from '../lib/logger.js';
import { isEventProcessed, saveEvent } from '../models/webhookEventModel.js';
import { applySuccessfulPayment, getPlanById, updateStripeSubscriptionState } from './subscriptionService.js';
import { afterPaymentCommitted } from './paymentService.js';
import { invalidateMetricsCache } from './metricsService.js';

export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'invoice.paid',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

function convertStripeStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'incomplete_expired':
      return 'expired';
    default:
      return 'incomplete';
  }
}

function toDate(unixSeconds) {
  if (!unixSeconds) {
    return null;
  }
  return new Date(unixSeconds * 1000);
}

function getId(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.id;
}

function getBillingPeriod(subscription) {
  let start = subscription.current_period_start;
  let end = subscription.current_period_end;

  if (subscription.items && subscription.items.data && subscription.items.data.length > 0) {
    const firstItem = subscription.items.data[0];
    if (firstItem.current_period_start) {
      start = firstItem.current_period_start;
    }
    if (firstItem.current_period_end) {
      end = firstItem.current_period_end;
    }
  }

  return { periodStart: toDate(start), periodEnd: toDate(end) };
}

function getSubscriptionIdFromInvoice(invoice) {
  if (invoice.parent && invoice.parent.subscription_details) {
    return getId(invoice.parent.subscription_details.subscription);
  }
  return getId(invoice.subscription);
}

async function buildPaymentFromInvoice(invoiceOrId) {
  const stripe = requireStripe();

  let invoice = invoiceOrId;
  if (typeof invoiceOrId === 'string') {
    invoice = await stripe.invoices.retrieve(invoiceOrId);
  }

  if (invoice.status !== 'paid') {
    return null;
  }

  const subscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) {
    logger.info({ invoice: invoice.id }, 'Paid invoice is not for a subscription; ignoring');
    return null;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  let plan = null;
  if (subscription.metadata && subscription.metadata.plan_id) {
    plan = await getPlanById(Number(subscription.metadata.plan_id));
  }
  if (!plan) {
    logger.warn({ subscriptionId }, 'Stripe subscription has no known plan_id metadata; ignoring');
    return null;
  }

  const customerId = getId(invoice.customer);
  let email = invoice.customer_email;
  let name = invoice.customer_name;

  if (!email && customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    email = customer.email;
    if (!name) {
      name = customer.name;
    }
  }
  if (!email) {
    throw new Error('No email found for Stripe invoice ' + invoice.id);
  }
  if (!name && subscription.metadata && subscription.metadata.customer_name) {
    name = subscription.metadata.customer_name;
  }

  const period = getBillingPeriod(subscription);

  let paidAt = new Date();
  if (invoice.status_transitions && invoice.status_transitions.paid_at) {
    paidAt = toDate(invoice.status_transitions.paid_at);
  }

  return {
    user: {
      email: email,
      name: name || null,
      stripeCustomerId: customerId,
    },
    subscription: {
      planId: plan.id,
      stripeSubscriptionId: subscription.id,
      status: convertStripeStatus(subscription.status),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    },
    payment: {
      provider: 'stripe',
      externalRef: invoice.id,
      amountCents: invoice.amount_paid,
      currency: invoice.currency,
      paidAt: paidAt,
    },
  };
}

function buildSubscriptionUpdate(event) {
  const subscription = event.data.object;
  const period = getBillingPeriod(subscription);

  let status = convertStripeStatus(subscription.status);
  if (event.type === 'customer.subscription.deleted') {
    status = 'canceled';
  }

  return {
    stripeSubscriptionId: subscription.id,
    status: status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  };
}

async function prepareAction(event) {
  const data = event.data.object;

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (data.mode !== 'subscription' || data.payment_status !== 'paid' || !data.invoice) {
      return null;
    }
    const payment = await buildPaymentFromInvoice(getId(data.invoice));
    return { kind: 'payment', payload: payment };
  }

  if (event.type === 'invoice.paid') {
    const payment = await buildPaymentFromInvoice(data);
    return { kind: 'payment', payload: payment };
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    return { kind: 'subscription-update', payload: buildSubscriptionUpdate(event) };
  }

  return null;
}

export async function handleStripeEvent(event) {
  if (!HANDLED_EVENTS.includes(event.type)) {
    return { status: 'ignored' };
  }

  const alreadyProcessed = await isEventProcessed(event.id);
  if (alreadyProcessed) {
    return { status: 'duplicate' };
  }

  const action = await prepareAction(event);

  const result = await withTransaction(async (client) => {
    const saved = await saveEvent(event, client);
    if (!saved) {
      return { status: 'duplicate' };
    }

    if (!action || !action.payload) {
      return { status: 'skipped' };
    }

    if (action.kind === 'payment') {
      const paymentResult = await applySuccessfulPayment(client, action.payload);
      return {
        status: 'processed',
        paymentId: paymentResult.paymentId,
        subscriptionId: paymentResult.subscription.id,
        userId: paymentResult.user.id,
      };
    }

    const updatedSubscription = await updateStripeSubscriptionState(client, action.payload);
    if (!updatedSubscription) {
      return { status: 'skipped' };
    }
    return { status: 'processed', subscriptionId: updatedSubscription.id };
  });

  if (result.status === 'processed') {
    if (action.kind === 'payment') {
      await afterPaymentCommitted(result.paymentId);
    } else {
      await invalidateMetricsCache();
    }
  }

  logger.info({ eventId: event.id, type: event.type, result: result }, 'Stripe webhook handled');
  return result;
}
