// Unit tests that need no PostgreSQL/Redis: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from '../src/lib/money.js';
import { renderPdfInvoice, renderTextInvoice } from '../src/services/invoiceRenderer.js';
import { storage } from '../src/lib/storage.js';

const invoice = {
  invoiceNumber: 'INV-2026-000042',
  issuedAt: new Date('2026-09-25T10:00:00Z'),
  customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
  plan: { name: 'Pro', interval: 'month' },
  period: { start: new Date('2026-09-25T00:00:00Z'), end: new Date('2026-10-25T00:00:00Z') },
  amountCents: 2900,
  currency: 'usd',
  paymentRef: 'in_test_123',
};

test('formatMoney formats cents in the given currency', () => {
  assert.equal(formatMoney(2900, 'usd'), '$29.00');
  assert.equal(formatMoney(123456, 'usd'), '$1,234.56');
  assert.equal(formatMoney(0), '$0.00');
});

test('text invoice contains the key billing details', () => {
  const text = renderTextInvoice(invoice);
  for (const expected of ['INV-2026-000042', 'Ada Lovelace <ada@example.com>', 'Pro', '2026-09-25 to 2026-10-25', '$29.00', 'in_test_123']) {
    assert.ok(text.includes(expected), `missing "${expected}"`);
  }
});

test('PDF invoice renders a valid PDF document', async () => {
  const pdf = await renderPdfInvoice(invoice);
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
});

test('storage rejects keys that escape the storage root', async () => {
  await assert.rejects(storage.save('../../evil.txt', 'x'), /Invalid storage key/);
  assert.equal(await storage.exists('../../package.json'), false);
});
