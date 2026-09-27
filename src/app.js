import express from 'express';
import { config } from './config/env.js';
import { pool } from './db/pool.js';
import { redis } from './lib/redis.js';
import { errorHandler, notFound, requestLogger } from './middleware/index.js';
import { webhookRouter } from './routes/webhooks.js';
import { checkoutRouter } from './routes/checkout.js';
import { invoiceRouter } from './routes/invoices.js';
import { adminRouter } from './routes/admin.js';
import { devRouter } from './routes/dev.js';

async function checkDatabase() {
  try {
    await pool.query('SELECT 1');
    return 'ok';
  } catch (err) {
    return 'error: ' + err.message;
  }
}

async function checkRedis() {
  try {
    await redis.ping();
    return 'ok';
  } catch (err) {
    return 'error: ' + err.message;
  }
}

async function healthCheck(req, res) {
  const database = await checkDatabase();
  const redisStatus = await checkRedis();
  const healthy = database === 'ok' && redisStatus === 'ok';

  let stripeStatus = 'not configured (use /api/dev/simulate-payment)';
  if (config.stripeEnabled) {
    stripeStatus = 'test-mode';
  }

  let statusCode = 503;
  let status = 'degraded';
  if (healthy) {
    statusCode = 200;
    status = 'ok';
  }

  res.status(statusCode).json({
    status: status,
    database: database,
    redis: redisStatus,
    stripe: stripeStatus,
  });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestLogger);

  app.use('/api/webhooks', webhookRouter);

  app.use(express.json({ limit: '100kb' }));

  app.get('/health', healthCheck);
  app.use('/api', checkoutRouter);
  app.use('/api/invoices', invoiceRouter);
  app.use('/api/admin', adminRouter);

  if (config.ENABLE_DEV_ROUTES) {
    app.use('/api/dev', devRouter);
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
