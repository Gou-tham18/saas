import { pool } from '../db/pool.js';

export async function isReminderSent(subscriptionId, periodEnd, db = pool) {
  const result = await db.query(
    'SELECT 1 FROM renewal_reminders WHERE subscription_id = $1 AND period_end = $2',
    [subscriptionId, periodEnd],
  );
  return result.rowCount > 0;
}

export async function saveReminder(subscriptionId, periodEnd, db = pool) {
  await db.query(
    `INSERT INTO renewal_reminders (subscription_id, period_end)
     VALUES ($1, $2)
     ON CONFLICT (subscription_id, period_end) DO NOTHING`,
    [subscriptionId, periodEnd],
  );
}
