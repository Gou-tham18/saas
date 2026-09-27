import { pool } from '../db/pool.js';

export async function upsertUser(user, db = pool) {
  const email = user.email.trim();
  const name = user.name || null;
  const stripeCustomerId = user.stripeCustomerId || null;

  const result = await db.query(
    `INSERT INTO users (email, name, stripe_customer_id)
     VALUES ($1, $2, $3)
     ON CONFLICT ((lower(email))) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, users.name),
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, users.stripe_customer_id),
       updated_at = now()
     RETURNING *`,
    [email, name, stripeCustomerId],
  );
  return result.rows[0];
}

export async function findUserByEmail(email, db = pool) {
  const result = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function findStripeCustomerId(email, db = pool) {
  const result = await db.query(
    'SELECT stripe_customer_id FROM users WHERE lower(email) = lower($1) AND stripe_customer_id IS NOT NULL',
    [email],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0].stripe_customer_id;
}
