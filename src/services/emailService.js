import { sendMail } from '../lib/mailer.js';
import { storage } from '../lib/storage.js';
import { config } from '../config/env.js';
import { formatMoney } from '../lib/money.js';
import { invoiceDownloadUrl } from './invoiceService.js';

function formatDate(date) {
  return new Date(date).toUTCString().slice(0, 16);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getGreeting(name) {
  if (name) {
    return 'Hi ' + name + ',';
  }
  return 'Hi,';
}

export async function sendPaymentConfirmationEmail(payment, invoice) {
  const amount = formatMoney(payment.amount_cents, payment.currency);
  const downloadLink = invoiceDownloadUrl(invoice);
  const greeting = getGreeting(payment.name);

  const details = [
    ['Plan', payment.plan_name + ' (billed per ' + payment.interval + ')'],
    ['Amount paid', amount],
    ['Status', payment.status],
    ['Current period', formatDate(payment.current_period_start) + ' - ' + formatDate(payment.current_period_end)],
    ['Next renewal', formatDate(payment.current_period_end)],
    ['Invoice', invoice.invoice_number],
  ];

  let textDetails = '';
  let htmlRows = '';
  for (const [label, value] of details) {
    textDetails += label + ': ' + value + '\n';
    htmlRows += '<tr><td style="color:#555">' + label + '</td><td><strong>' + escapeHtml(value) + '</strong></td></tr>';
  }

  const text =
    greeting + '\n\n' +
    'Thanks for your payment. Your subscription is now active.\n\n' +
    textDetails + '\n' +
    'Download your invoice: ' + downloadLink;

  const html =
    '<p>' + escapeHtml(greeting) + '</p>' +
    '<p>Thanks for your payment. Your subscription is now <strong>active</strong>.</p>' +
    '<table cellpadding="6" style="border-collapse:collapse">' + htmlRows + '</table>' +
    '<p><a href="' + downloadLink + '">Download invoice ' + escapeHtml(invoice.invoice_number) + '</a></p>' +
    '<p style="color:#888;font-size:12px">Test mode - no real money was charged.</p>';

  const attachments = [];
  if (config.ATTACH_INVOICE_TO_EMAIL) {
    const fileContent = await storage.read(invoice.storage_key);
    attachments.push({
      filename: invoice.invoice_number + '.' + invoice.format,
      content: fileContent,
    });
  }

  return await sendMail({
    to: payment.email,
    subject: 'Payment received - ' + payment.plan_name + ' subscription (' + invoice.invoice_number + ')',
    text: text,
    html: html,
    attachments: attachments,
  });
}

export async function sendRenewalReminderEmail(subscription) {
  const amount = formatMoney(subscription.amount_cents, subscription.currency);
  const renewalDate = formatDate(subscription.current_period_end);
  const greeting = getGreeting(subscription.name);

  let message;
  let subject;
  if (subscription.cancel_at_period_end) {
    message = 'Your ' + subscription.plan_name + ' subscription is set to end on ' + renewalDate + '. Renew before then to keep access.';
    subject = 'Your ' + subscription.plan_name + ' subscription expires on ' + renewalDate;
  } else {
    message = 'Your ' + subscription.plan_name + ' subscription renews on ' + renewalDate + ' for ' + amount + '.';
    subject = 'Your ' + subscription.plan_name + ' subscription renews on ' + renewalDate;
  }

  const footer = 'No action is needed if your payment details are up to date.';

  return await sendMail({
    to: subscription.email,
    subject: subject,
    text: greeting + '\n\n' + message + '\n\n' + footer,
    html: '<p>' + escapeHtml(greeting) + '</p><p>' + escapeHtml(message) + '</p><p>' + footer + '</p>',
  });
}
