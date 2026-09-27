import crypto from 'node:crypto';
import { pool, withTransaction } from './pool.js';
import { migrate } from './migrate.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { invalidateMetricsCache } from '../services/metricsService.js';

const PLANS = [
  { code: 'starter', name: 'Starter', description: 'For individuals getting started', amount_cents: 900, interval: 'month' },
  { code: 'pro', name: 'Pro', description: 'For growing teams', amount_cents: 2900, interval: 'month' },
  { code: 'business', name: 'Business', description: 'Annual plan for organisations', amount_cents: 29900, interval: 'year' },
];

const ONE_DAY = 24 * 60 * 60 * 1000;
const DEMO_PLAN_ORDER = ['starter', 'pro', 'pro', 'business'];

async function seedPlans(client) {
  for (const plan of PLANS) {
    await client.query(
      `INSERT INTO plans (code, name, description, amount_cents, interval)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         amount_cents = EXCLUDED.amount_cents,
         interval = EXCLUDED.interval`,
      [plan.code, plan.name, plan.description, plan.amount_cents, plan.interval],
    );
  }
}

async function getPlansByCode(client) {
  const result = await client.query('SELECT * FROM plans');
  const plansByCode = {};
  for (const plan of result.rows) {
    plansByCode[plan.code] = plan;
  }
  return plansByCode;
}

async function createDemoCustomer(client, number, plan) {
  let periodLength = 30 * ONE_DAY;
  if (plan.interval === 'year') {
    periodLength = 365 * ONE_DAY;
  }

  const periodEnd = new Date(Date.now() + ((number * 29) / 24 - 2) * ONE_DAY);
  const periodStart = new Date(periodEnd.getTime() - periodLength);

  let status = 'active';
  if (periodEnd < new Date()) {
    status = 'expired';
  }

  const userResult = await client.query(
    `INSERT INTO users (email, name, created_at)
     VALUES ($1, $2, $3)
     ON CONFLICT ((lower(email))) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['demo' + number + '@example.com', 'Demo User ' + number, periodStart],
  );
  const userId = userResult.rows[0].id;

  const existing = await client.query('SELECT id FROM subscriptions WHERE user_id = $1', [userId]);
  if (existing.rows.length > 0) {
    return;
  }

  const subscriptionResult = await client.query(
    `INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end, created_at)
     VALUES ($1, $2, $3, $4, $5, $4)
     RETURNING id`,
    [userId, plan.id, status, periodStart, periodEnd],
  );
  const subscriptionId = subscriptionResult.rows[0].id;

  await client.query(
    `INSERT INTO payments (user_id, subscription_id, provider, external_ref, amount_cents, currency, status, paid_at)
     VALUES ($1, $2, 'seed', $3, $4, $5, 'succeeded', $6)`,
    [userId, subscriptionId, 'seed_' + crypto.randomUUID(), plan.amount_cents, plan.currency, periodStart],
  );
}

async function seedDemoCustomers(client) {
  const plansByCode = await getPlansByCode(client);

  for (let number = 1; number <= 24; number++) {
    const planCode = DEMO_PLAN_ORDER[number % DEMO_PLAN_ORDER.length];
    await createDemoCustomer(client, number, plansByCode[planCode]);
  }
}

async function runSeed() {
  const includeDemoData = process.argv.includes('--demo');

  try {
    await migrate();

    await withTransaction(async (client) => {
      await seedPlans(client);
      if (includeDemoData) {
        await seedDemoCustomers(client);
      }
    });

    await invalidateMetricsCache();
    logger.info({ plans: PLANS.length, demo: includeDemoData }, 'Seed complete');
  } catch (err) {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  } finally {
    await pool.end();
    await redis.quit();
  }
}

runSeed();
