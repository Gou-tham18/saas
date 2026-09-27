import { pool } from '../db/pool.js';

export async function getActivePlans(db = pool) {
  const result = await db.query(
    `SELECT id, code, name, description, amount_cents, currency, interval
     FROM plans
     WHERE is_active
     ORDER BY amount_cents`,
  );
  return result.rows;
}

export async function findPlanByCode(code, db = pool) {
  const result = await db.query('SELECT * FROM plans WHERE code = $1 AND is_active', [code]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function findPlanById(id, db = pool) {
  const result = await db.query('SELECT * FROM plans WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}
