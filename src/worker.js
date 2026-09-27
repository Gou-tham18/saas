import { Worker } from 'bullmq';
import cron from 'node-cron';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { pool } from './db/pool.js';
import { createRedisConnection, redis } from './lib/redis.js';
import { migrate } from './db/migrate.js';
import { NOTIFICATIONS_QUEUE, closeQueue } from './queues/index.js';
import { processNotificationJob } from './workers/notificationProcessor.js';
import { runExpiryScan } from './jobs/expiryScanner.js';

if (!cron.validate(config.EXPIRY_SCAN_CRON)) {
  logger.fatal({ expr: config.EXPIRY_SCAN_CRON }, 'Invalid EXPIRY_SCAN_CRON expression');
  process.exit(1);
}

await migrate();

const workerConnection = createRedisConnection({ forBullMQ: true, name: 'worker' });

const worker = new Worker(NOTIFICATIONS_QUEUE, processNotificationJob, {
  connection: workerConnection,
  concurrency: 5,
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job.id, job: job.name, attempt: job.attemptsMade, err: err.message }, 'Job failed');
});

worker.on('error', (err) => {
  logger.error({ err: err.message }, 'Worker error');
});

async function scheduledScan() {
  try {
    await runExpiryScan();
  } catch (err) {
    logger.error({ err }, 'Scheduled expiry scan failed');
  }
}

const cronTask = cron.schedule(config.EXPIRY_SCAN_CRON, scheduledScan, {
  name: 'expiry-scan',
  timezone: config.CRON_TIMEZONE,
  noOverlap: true,
});

logger.info(
  { queue: NOTIFICATIONS_QUEUE, cron: config.EXPIRY_SCAN_CRON, reminderDays: config.REMINDER_DAYS_BEFORE_EXPIRY },
  'Worker started',
);

scheduledScan();

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down worker');

  try {
    await cronTask.stop();
    await worker.close();
    await closeQueue();
    await workerConnection.quit();
    await pool.end();
    await redis.quit();
  } catch (err) {
    logger.error({ err }, 'Error while shutting down worker');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
