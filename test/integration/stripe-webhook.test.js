// Integration test for the Stripe webhook pipeline. Requires PostgreSQL and
// Redis (`docker compose up -d`), but not a Stripe account: the Stripe SDK is
// pointed at a local fake API and webhooks are signed with a test secret.
//
//   npm run test:integration
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.STRIPE_SECRET_KEY = 'sk_test_integration';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integration_secret';
process.env.NODE_ENV = 'test';

// Imported after the env is set so config picks it up.
const { stripe } = await import('../../src/lib/stripe.js');
const { createApp } = await import('../../src/app.js');
const { migrate } = await import('../../src/db/migrate.js');
const { pool } = await import('../../src/db/pool.js');
const { redis } = await import('../../src/lib/redis.js');
const { closeQueue } = await import('../../src/queues/index.js');

const run = crypto.randomBytes(4).toString('hex'); // unique ids per run
const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const ids = { sub: `sub_${run}`, cus: `cus_${run}`, in1: `in_1_${run}`, in2: `in_2_${run}` };

let planId;
let sub;
const invoices = {};
let fakeStripe;
let server;
let baseUrl;

before(async () => {
  await migrate();
  const { rows } = await pool.query(
    `INSERT INTO plans (code, name, amount_cents, interval) VALUES ('it-pro', 'IT Pro', 2900, 'month')
     ON CONFLICT (code) DO UPDATE SET is_active = true RETURNING id`,
  );
  planId = rows[0].id;

  sub = {
    id: ids.sub, object: 'subscription', status: 'active', cancel_at_period_end: false, customer: ids.cus,
    metadata: { plan_id: String(planId) },
    // Current API shape: billing period lives on the subscription item.
    items: { data: [{ current_period_start: now, current_period_end: now + 30 * DAY }] },
  };
  invoices[ids.in1] = {
    id: ids.in1, object: 'invoice', status: 'paid', amount_paid: 2900, currency: 'usd', customer: ids.cus,
    customer_email: `it-${run}@example.com`, customer_name: 'Integration Tester',
    status_transitions: { paid_at: now }, parent: { subscription_details: { subscription: ids.sub } },
  };

  fakeStripe = http.createServer((req, res) => {
    const [, , resource, id] = req.url.split('?')[0].split('/'); // /v1/<resource>/<id>
    const body = resource === 'invoices' ? invoices[id] : resource === 'subscriptions' && id === ids.sub ? sub : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { error: { type: 'invalid_request_error', message: 'No such object' } }));
  });
  await new Promise((r) => fakeStripe.listen(0, r));
  stripe._setApiField('host', 'localhost');
  stripe._setApiField('port', fakeStripe.address().port);
  stripe._setApiField('protocol', 'http');

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await pool.query('DELETE FROM users WHERE stripe_customer_id = $1', [ids.cus]);
  server?.close();
  fakeStripe?.close();
  await closeQueue();
  await Promise.allSettled([pool.end(), redis.quit()]);
});

async function sendEvent(id, type, object, { secret = process.env.STRIPE_WEBHOOK_SECRET } = {}) {
  const payload = JSON.stringify({ id: `evt_${id}_${run}`, object: 'event', type, data: { object } });
  const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }) },
    body: payload,
  });
  return { status: res.status, body: await res.json() };
}

const checkoutCompleted = () =>
  ({ id: `cs_${run}`, object: 'checkout.session', mode: 'subscription', payment_status: 'paid', invoice: ids.in1 });

test('rejects webhooks with an invalid signature', async () => {
  const res = await sendEvent('bad', 'invoice.paid', invoices[ids.in1], { secret: 'whsec_wrong' });
  assert.equal(res.status, 400);
});

test('checkout.session.completed creates the user, subscription and payment', async () => {
  const res = await sendEvent('1', 'checkout.session.completed', checkoutCompleted());
  assert.equal(res.body.status, 'processed');
  assert.ok(res.body.paymentId);

  const { rows: [row] } = await pool.query(
    `SELECT u.email, u.name, s.status, s.current_period_end FROM subscriptions s JOIN users u ON u.id = s.user_id
      WHERE s.stripe_subscription_id = $1`, [ids.sub]);
  assert.equal(row.email, `it-${run}@example.com`);
  assert.equal(row.status, 'active');
  assert.equal(row.current_period_end.getTime(), (now + 30 * DAY) * 1000);
});

test('invoice.paid for the same first invoice does not record a second payment', async () => {
  const res = await sendEvent('2', 'invoice.paid', invoices[ids.in1]);
  assert.equal(res.body.status, 'processed');
  assert.equal(res.body.paymentId, null);
});

test('a redelivered event is detected as a duplicate', async () => {
  const res = await sendEvent('1', 'checkout.session.completed', checkoutCompleted());
  assert.equal(res.body.status, 'duplicate');
});

test('customer.subscription.updated mirrors cancel_at_period_end', async () => {
  const res = await sendEvent('3', 'customer.subscription.updated', { ...sub, cancel_at_period_end: true });
  assert.equal(res.body.status, 'processed');
  const { rows: [row] } = await pool.query(
    'SELECT cancel_at_period_end FROM subscriptions WHERE stripe_subscription_id = $1', [ids.sub]);
  assert.equal(row.cancel_at_period_end, true);
});

test('a renewal invoice records a new payment and extends the period', async () => {
  sub.items.data[0] = { current_period_start: now + 30 * DAY, current_period_end: now + 60 * DAY };
  sub.cancel_at_period_end = false;
  invoices[ids.in2] = { ...invoices[ids.in1], id: ids.in2 };

  const res = await sendEvent('4', 'invoice.paid', invoices[ids.in2]);
  assert.ok(res.body.paymentId);

  const { rows: [row] } = await pool.query(
    `SELECT s.current_period_end, s.cancel_at_period_end, COUNT(p.id)::int AS payments
       FROM subscriptions s LEFT JOIN payments p ON p.subscription_id = s.id
      WHERE s.stripe_subscription_id = $1 GROUP BY s.id`, [ids.sub]);
  assert.equal(row.payments, 2);
  assert.equal(row.cancel_at_period_end, false);
  assert.equal(row.current_period_end.getTime(), (now + 60 * DAY) * 1000);
});

test('unhandled event types are acknowledged and ignored', async () => {
  const res = await sendEvent('5', 'customer.created', { id: ids.cus });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ignored');
});
