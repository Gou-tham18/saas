import { upsertUser, findUserByEmail } from '../models/userModel.js';
import { getActivePlans, findPlanByCode, findPlanById } from '../models/planModel.js';
import {
  upsertStripeSubscription,
  findActiveSimulatedSubscription,
  renewSimulatedSubscription,
  createSimulatedSubscription,
  updateStripeSubscriptionStatus,
  getSubscriptionsByUser,
} from '../models/subscriptionModel.js';
import { createPayment } from '../models/paymentModel.js';
import { getInvoicesByUser } from '../models/invoiceModel.js';

export async function listActivePlans() {
  return await getActivePlans();
}

export async function getPlanByCode(code) {
  return await findPlanByCode(code);
}

export async function getPlanById(id) {
  return await findPlanById(id);
}

async function saveSubscription(client, userId, subscription) {
  if (subscription.stripeSubscriptionId) {
    return await upsertStripeSubscription(userId, subscription, client);
  }

  const existing = await findActiveSimulatedSubscription(userId, client);
  if (existing) {
    return await renewSimulatedSubscription(existing.id, subscription, client);
  }
  return await createSimulatedSubscription(userId, subscription, client);
}

export async function applySuccessfulPayment(client, data) {
  const user = await upsertUser(data.user, client);
  const subscription = await saveSubscription(client, user.id, data.subscription);

  const paymentId = await createPayment(
    {
      userId: user.id,
      subscriptionId: subscription.id,
      provider: data.payment.provider,
      externalRef: data.payment.externalRef,
      amountCents: data.payment.amountCents,
      currency: data.payment.currency,
      paidAt: data.payment.paidAt,
    },
    client,
  );

  return { user: user, subscription: subscription, paymentId: paymentId };
}

export async function updateStripeSubscriptionState(client, subscription) {
  return await updateStripeSubscriptionStatus(subscription, client);
}

export async function getUserOverview(email) {
  const user = await findUserByEmail(email);
  if (!user) {
    return null;
  }

  const subscriptions = await getSubscriptionsByUser(user.id);
  const invoices = await getInvoicesByUser(user.id);

  return { user: user, subscriptions: subscriptions, invoices: invoices };
}
