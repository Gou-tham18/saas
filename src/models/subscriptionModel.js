import { pool } from '../db/pool.js';

export const ACTIVE_STATUSES = ['active', 'trialing'];

export async function upsertStripeSubscription(userId, subscription, db = pool) {
  const result = await db.query(
    `INSERT INTO subscriptions
       (user_id, plan_id, stripe_subscription_id, status, current_period_start, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       status = EXCLUDED.status,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at = now()
     RETURNING *`,
    [
      userId,
      subscription.planId,
      subscription.stripeSubscriptionId,
      subscription.status,
      subscription.periodStart,
      subscription.periodEnd,
      subscription.cancelAtPeriodEnd === true,
    ],
  );
  return result.rows[0];
}

export async function findActiveSimulatedSubscription(userId, db = pool) {
  const result = await db.query(
    `SELECT id FROM subscriptions
     WHERE user_id = $1 AND stripe_subscription_id IS NULL AND status = ANY($2)
     ORDER BY current_period_end DESC
     LIMIT 1
     FOR UPDATE`,
    [userId, ACTIVE_STATUSES],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function renewSimulatedSubscription(subscriptionId, subscription, db = pool) {
  const result = await db.query(
    `UPDATE subscriptions
     SET plan_id = $2, status = $3, current_period_start = $4, current_period_end = $5,
         cancel_at_period_end = false, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [subscriptionId, subscription.planId, subscription.status, subscription.periodStart, subscription.periodEnd],
  );
  return result.rows[0];
}

export async function createSimulatedSubscription(userId, subscription, db = pool) {
  const result = await db.query(
    `INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, subscription.planId, subscription.status, subscription.periodStart, subscription.periodEnd],
  );
  return result.rows[0];
}

export async function updateStripeSubscriptionStatus(subscription, db = pool) {
  const result = await db.query(
    `UPDATE subscriptions SET
       status = $2,
       current_period_start = COALESCE($3, current_period_start),
       current_period_end = COALESCE($4, current_period_end),
       cancel_at_period_end = $5,
       canceled_at = CASE WHEN $2 = 'canceled' THEN COALESCE(canceled_at, now()) ELSE canceled_at END,
       updated_at = now()
     WHERE stripe_subscription_id = $1
     RETURNING *`,
    [
      subscription.stripeSubscriptionId,
      subscription.status,
      subscription.periodStart,
      subscription.periodEnd,
      subscription.cancelAtPeriodEnd === true,
    ],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getSubscriptionsByUser(userId, db = pool) {
  const result = await db.query(
    `SELECT s.id, s.status, s.current_period_start, s.current_period_end, s.cancel_at_period_end,
            s.stripe_subscription_id, p.code AS plan_code, p.name AS plan_name,
            p.amount_cents, p.currency, p.interval
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function getSubscriptionForReminder(subscriptionId, db = pool) {
  const result = await db.query(
    `SELECT s.id, s.status, s.current_period_end, s.cancel_at_period_end,
            u.email, u.name, p.name AS plan_name, p.amount_cents, p.currency
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     JOIN plans p ON p.id = s.plan_id
     WHERE s.id = $1`,
    [subscriptionId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getExpiringSubscriptionsWithoutReminder(days, db = pool) {
  const result = await db.query(
    `SELECT s.id, s.current_period_end
     FROM subscriptions s
     WHERE s.status IN ('active', 'trialing')
       AND s.current_period_end > now()
       AND s.current_period_end <= now() + make_interval(days => $1)
       AND NOT EXISTS (
         SELECT 1 FROM renewal_reminders r
         WHERE r.subscription_id = s.id AND r.period_end = s.current_period_end
       )`,
    [days],
  );
  return result.rows;
}

export async function expireLapsedSubscriptions(db = pool) {
  const result = await db.query(
    `UPDATE subscriptions
     SET status = 'expired', updated_at = now()
     WHERE status IN ('active', 'trialing')
       AND stripe_subscription_id IS NULL
       AND current_period_end <= now()`,
  );
  return result.rowCount;
}
