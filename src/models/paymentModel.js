import { pool } from '../db/pool.js';

export async function createPayment(payment, db = pool) {
  let paidAt = payment.paidAt;
  if (!paidAt) {
    paidAt = new Date();
  }

  const result = await db.query(
    `INSERT INTO payments (user_id, subscription_id, provider, external_ref, amount_cents, currency, status, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7)
     ON CONFLICT (external_ref) DO NOTHING
     RETURNING id`,
    [
      payment.userId,
      payment.subscriptionId,
      payment.provider,
      payment.externalRef,
      payment.amountCents,
      payment.currency.toLowerCase(),
      paidAt,
    ],
  );

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0].id;
}

export async function getPaymentDetails(paymentId, db = pool) {
  const result = await db.query(
    `SELECT pay.id AS payment_id, pay.external_ref, pay.amount_cents, pay.currency, pay.paid_at,
            u.id AS user_id, u.email, u.name,
            s.id AS subscription_id, s.status, s.current_period_start, s.current_period_end,
            pl.name AS plan_name, pl.code AS plan_code, pl.interval
     FROM payments pay
     JOIN users u ON u.id = pay.user_id
     LEFT JOIN subscriptions s ON s.id = pay.subscription_id
     LEFT JOIN plans pl ON pl.id = s.plan_id
     WHERE pay.id = $1`,
    [paymentId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getPaymentsMissingConfirmation(olderThanMinutes, db = pool) {
  const result = await db.query(
    `SELECT p.id
     FROM payments p
     WHERE p.status = 'succeeded'
       AND p.provider <> 'seed'
       AND p.paid_at < now() - make_interval(mins => $1)
       AND p.paid_at > now() - interval '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM invoices i
         WHERE i.payment_id = p.id AND i.emailed_at IS NOT NULL
       )
     ORDER BY p.id
     LIMIT 100`,
    [olderThanMinutes],
  );

  const paymentIds = [];
  for (const row of result.rows) {
    paymentIds.push(row.id);
  }
  return paymentIds;
}
