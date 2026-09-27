import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { pool } from './db/pool.js';
import { redis } from './lib/redis.js';
import { migrate } from './db/migrate.js';
import { closeQueue } from './queues/index.js';

await migrate();

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, stripe: config.stripeEnabled, devRoutes: config.ENABLE_DEV_ROUTES },
    'API listening on ' + config.APP_BASE_URL,
  );
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down API');

  server.close();
  try {
    await closeQueue();
    await pool.end();
    await redis.quit();
  } catch (err) {
    logger.error({ err }, 'Error while shutting down API');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
