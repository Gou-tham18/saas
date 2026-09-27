import { runExpiryScan } from './expiryScanner.js';
import { pool } from '../db/pool.js';
import { redis } from '../lib/redis.js';
import { closeQueue } from '../queues/index.js';
import { logger } from '../lib/logger.js';

async function main() {
  try {
    const summary = await runExpiryScan();
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    logger.error({ err }, 'Expiry scan failed');
    process.exitCode = 1;
  } finally {
    await closeQueue();
    await pool.end();
    await redis.quit();
  }
}

main();
