import { pool } from '../db/pool.js';

export async function findInvoiceByPaymentId(paymentId, db = pool) {
  const result = await db.query('SELECT * FROM invoices WHERE payment_id = $1', [paymentId]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function findInvoiceByNumber(invoiceNumber, db = pool) {
  const result = await db.query('SELECT * FROM invoices WHERE invoice_number = $1', [invoiceNumber]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function lockInvoiceForPayment(paymentId, db) {
  await db.query('SELECT pg_advisory_xact_lock($1)', [paymentId]);
}

export async function getNextInvoiceSequence(db = pool) {
  const result = await db.query("SELECT nextval('invoice_number_seq') AS seq");
  return result.rows[0].seq;
}

export async function createInvoice(invoice, db = pool) {
  const result = await db.query(
    `INSERT INTO invoices (invoice_number, payment_id, user_id, subscription_id, amount_cents, currency,
                           format, storage_key, access_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      invoice.invoiceNumber,
      invoice.paymentId,
      invoice.userId,
      invoice.subscriptionId,
      invoice.amountCents,
      invoice.currency,
      invoice.format,
      invoice.storageKey,
      invoice.accessToken,
    ],
  );
  return result.rows[0];
}

export async function markInvoiceAsEmailed(invoiceId, db = pool) {
  await db.query('UPDATE invoices SET emailed_at = now() WHERE id = $1', [invoiceId]);
}

export async function getInvoicesByUser(userId, db = pool) {
  const result = await db.query(
    `SELECT invoice_number, amount_cents, currency, format, emailed_at, created_at
     FROM invoices
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
}
