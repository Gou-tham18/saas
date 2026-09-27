import PDFDocument from 'pdfkit';
import { formatMoney } from '../lib/money.js';

function formatDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function getBilledTo(customer) {
  if (customer.name) {
    return customer.name + ' <' + customer.email + '>';
  }
  return customer.email;
}

export function renderTextInvoice(invoice) {
  const line = '-'.repeat(48);
  const total = formatMoney(invoice.amountCents, invoice.currency);

  const lines = [
    'SaaS Platform - INVOICE',
    line,
    'Invoice number : ' + invoice.invoiceNumber,
    'Issued         : ' + formatDate(invoice.issuedAt),
    'Billed to      : ' + getBilledTo(invoice.customer),
    line,
    'Plan           : ' + invoice.plan.name + ' (billed per ' + invoice.plan.interval + ')',
    'Service period : ' + formatDate(invoice.period.start) + ' to ' + formatDate(invoice.period.end),
    'Payment ref    : ' + invoice.paymentRef,
    line,
    'TOTAL PAID     : ' + total,
    line,
    'Status: PAID (test mode - no real money was charged)',
    '',
  ];
  return lines.join('\n');
}

export function renderPdfInvoice(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'Invoice ' + invoice.invoiceNumber } });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const total = formatMoney(invoice.amountCents, invoice.currency);
    const period = formatDate(invoice.period.start) + ' - ' + formatDate(invoice.period.end);

    doc.fontSize(22).text('INVOICE', { align: 'right' });
    doc.fontSize(10).fillColor('#555');
    doc.text('Invoice #: ' + invoice.invoiceNumber, { align: 'right' });
    doc.text('Issued: ' + formatDate(invoice.issuedAt), { align: 'right' });

    doc.moveDown(2);
    doc.fillColor('#000').fontSize(12).text('SaaS Platform');
    doc.fontSize(10).fillColor('#555').text('Subscription & Analytics Platform');

    doc.moveDown(1.5);
    doc.fillColor('#000').fontSize(11).text('Billed to:');
    doc.fontSize(10);
    if (invoice.customer.name) {
      doc.text(invoice.customer.name);
    }
    doc.text(invoice.customer.email);

    const tableTop = doc.y + 25;
    const descriptionX = 50;
    const periodX = 280;
    const amountX = 460;

    doc.fontSize(10).fillColor('#000');
    doc.text('Description', descriptionX, tableTop);
    doc.text('Service period', periodX, tableTop);
    doc.text('Amount', amountX, tableTop, { width: 85, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).strokeColor('#ccc').stroke();

    const rowY = tableTop + 25;
    doc.text(invoice.plan.name + ' plan (per ' + invoice.plan.interval + ')', descriptionX, rowY, { width: 220 });
    doc.text(period, periodX, rowY);
    doc.text(total, amountX, rowY, { width: 85, align: 'right' });
    doc.moveTo(50, rowY + 25).lineTo(545, rowY + 25).stroke();

    doc.fontSize(12);
    doc.text('Total paid', periodX, rowY + 40);
    doc.text(total, amountX, rowY + 40, { width: 85, align: 'right' });

    doc.fontSize(9).fillColor('#555');
    doc.text('Payment reference: ' + invoice.paymentRef, 50, rowY + 90);
    doc.text('Status: PAID - test mode, no real money was charged.', 50, rowY + 105);

    doc.end();
  });
}
