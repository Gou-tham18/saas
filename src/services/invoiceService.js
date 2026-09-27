import crypto from 'node:crypto';
import { withTransaction } from '../db/pool.js';
import { storage } from '../lib/storage.js';
import { config } from '../config/env.js';
import {
  findInvoiceByPaymentId,
  findInvoiceByNumber,
  lockInvoiceForPayment,
  getNextInvoiceSequence,
  createInvoice,
  markInvoiceAsEmailed,
} from '../models/invoiceModel.js';
import { getPaymentDetails, getPaymentsMissingConfirmation } from '../models/paymentModel.js';
import { renderPdfInvoice, renderTextInvoice } from './invoiceRenderer.js';

export async function getPaymentContext(paymentId) {
  return await getPaymentDetails(paymentId);
}

export function invoiceDownloadUrl(invoice) {
  const invoiceNumber = encodeURIComponent(invoice.invoice_number);
  return config.APP_BASE_URL + '/api/invoices/' + invoiceNumber + '/download?token=' + invoice.access_token;
}

function buildInvoiceNumber(sequence, date) {
  const year = date.getUTCFullYear();
  const number = String(sequence).padStart(6, '0');
  return 'INV-' + year + '-' + number;
}

function buildStorageKey(invoiceNumber, format, date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return year + '/' + month + '/' + invoiceNumber + '.' + format;
}

export async function createInvoiceForPayment(paymentId) {
  const existingInvoice = await findInvoiceByPaymentId(paymentId);
  if (existingInvoice) {
    return existingInvoice;
  }

  const payment = await getPaymentContext(paymentId);
  if (!payment) {
    throw new Error('Payment ' + paymentId + ' not found');
  }

  return await withTransaction(async (client) => {
    await lockInvoiceForPayment(paymentId, client);

    const invoiceCreatedMeanwhile = await findInvoiceByPaymentId(paymentId, client);
    if (invoiceCreatedMeanwhile) {
      return invoiceCreatedMeanwhile;
    }

    const issuedAt = new Date();
    const sequence = await getNextInvoiceSequence(client);
    const invoiceNumber = buildInvoiceNumber(sequence, issuedAt);
    const format = config.INVOICE_FORMAT;

    const invoiceData = {
      invoiceNumber: invoiceNumber,
      issuedAt: issuedAt,
      customer: { name: payment.name, email: payment.email },
      plan: {
        name: payment.plan_name || 'Subscription',
        interval: payment.interval || 'month',
      },
      period: {
        start: payment.current_period_start || payment.paid_at,
        end: payment.current_period_end || payment.paid_at,
      },
      amountCents: payment.amount_cents,
      currency: payment.currency,
      paymentRef: payment.external_ref,
    };

    let fileContent;
    if (format === 'pdf') {
      fileContent = await renderPdfInvoice(invoiceData);
    } else {
      fileContent = renderTextInvoice(invoiceData);
    }

    const storageKey = buildStorageKey(invoiceNumber, format, issuedAt);
    await storage.save(storageKey, fileContent);

    const accessToken = crypto.randomBytes(24).toString('base64url');

    return await createInvoice(
      {
        invoiceNumber: invoiceNumber,
        paymentId: paymentId,
        userId: payment.user_id,
        subscriptionId: payment.subscription_id,
        amountCents: payment.amount_cents,
        currency: payment.currency,
        format: format,
        storageKey: storageKey,
        accessToken: accessToken,
      },
      client,
    );
  });
}

export async function markInvoiceEmailed(invoiceId) {
  await markInvoiceAsEmailed(invoiceId);
}

export async function findInvoiceForDownload(invoiceNumber, token) {
  const invoice = await findInvoiceByNumber(invoiceNumber);
  if (!invoice) {
    return null;
  }
  if (typeof token !== 'string') {
    return null;
  }

  const savedToken = Buffer.from(invoice.access_token);
  const givenToken = Buffer.from(token);

  if (savedToken.length !== givenToken.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(savedToken, givenToken)) {
    return null;
  }
  return invoice;
}

export async function findPaymentsMissingConfirmation(olderThanMinutes = 5) {
  return await getPaymentsMissingConfirmation(olderThanMinutes);
}
