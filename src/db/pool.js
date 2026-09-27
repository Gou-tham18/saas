import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

function toNumber(value) {
  return Number(value);
}

pg.types.setTypeParser(pg.types.builtins.INT8, toNumber);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, toNumber);

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export async function withTransaction(work) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'Rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
}
