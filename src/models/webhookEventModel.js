import { pool } from '../db/pool.js';

export async function isEventProcessed(eventId, db = pool) {
  const result = await db.query('SELECT 1 FROM webhook_events WHERE id = $1', [eventId]);
  return result.rowCount > 0;
}

export async function saveEvent(event, db = pool) {
  const result = await db.query(
    `INSERT INTO webhook_events (id, type, processed_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [event.id, event.type],
  );
  return result.rowCount > 0;
}
