import { pool } from '../db/pool.js';

const LIVE_SUBSCRIPTION = `s.status IN ('active', 'trialing') AND s.current_period_end > now()`;

export async function getSubscriberStats(expiringWithinDays, db = pool) {
  const result = await db.query(
    `SELECT
       COUNT(DISTINCT s.user_id) AS active_subscribers,
       COUNT(*) AS active_subscriptions,
       COALESCE(SUM(CASE WHEN p.interval = 'year' THEN p.amount_cents / 12.0 ELSE p.amount_cents END), 0)::bigint AS mrr_cents,
       COUNT(*) FILTER (WHERE s.current_period_end < now() + make_interval(days => $1)) AS expiring_soon,
       COUNT(*) FILTER (WHERE s.cancel_at_period_end) AS pending_cancellation
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE ${LIVE_SUBSCRIPTION}`,
    [expiringWithinDays],
  );
  return result.rows[0];
}

export async function getRevenueStats(db = pool) {
  const result = await db.query(
    `SELECT
       COALESCE(SUM(amount_cents), 0) AS total_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE paid_at >= now() - interval '30 days'), 0) AS last_30d_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE paid_at >= date_trunc('month', now())), 0) AS month_to_date_cents,
       COUNT(*) AS payment_count,
       (SELECT COUNT(*) FROM users WHERE created_at >= now() - interval '30 days') AS new_users_30d
     FROM payments
     WHERE status = 'succeeded'`,
  );
  return result.rows[0];
}

export async function getPlanStats(db = pool) {
  const result = await db.query(
    `SELECT p.code, p.name, p.interval, p.amount_cents, COUNT(s.id) AS active_subscriptions
     FROM plans p
     LEFT JOIN subscriptions s ON s.plan_id = p.id AND ${LIVE_SUBSCRIPTION}
     GROUP BY p.id
     ORDER BY p.amount_cents`,
  );
  return result.rows;
}

export async function getDailyRevenue(days, db = pool) {
  const result = await db.query(
    `SELECT
       to_char(d, 'YYYY-MM-DD') AS day,
       COALESCE(SUM(p.amount_cents), 0) AS revenue_cents,
       COUNT(p.id) AS payments
     FROM generate_series(current_date - ($1::int - 1), current_date, interval '1 day') d
     LEFT JOIN payments p ON p.status = 'succeeded' AND p.paid_at::date = d::date
     GROUP BY d
     ORDER BY d`,
    [days],
  );
  return result.rows;
}

export async function findExpiringSubscriptions(days, limit, db = pool) {
  const result = await db.query(
    `SELECT s.id, u.email, u.name, p.code AS plan_code, p.name AS plan_name,
            s.current_period_end, s.cancel_at_period_end
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     JOIN plans p ON p.id = s.plan_id
     WHERE ${LIVE_SUBSCRIPTION}
       AND s.current_period_end < now() + make_interval(days => $1)
     ORDER BY s.current_period_end
     LIMIT $2`,
    [days, limit],
  );
  return result.rows;
}
