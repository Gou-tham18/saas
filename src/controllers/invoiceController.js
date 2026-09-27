import { HttpError } from '../lib/httpError.js';
import { storage } from '../lib/storage.js';
import { findInvoiceForDownload } from '../services/invoiceService.js';

function getContentType(format) {
  if (format === 'pdf') {
    return 'application/pdf';
  }
  return 'text/plain; charset=utf-8';
}

export async function downloadInvoice(req, res, next) {
  const invoiceNumber = req.params.invoiceNumber;
  const token = req.query.token;

  const invoice = await findInvoiceForDownload(invoiceNumber, token);
  if (!invoice) {
    throw new HttpError(404, 'Invoice not found');
  }

  const fileExists = await storage.exists(invoice.storage_key);
  if (!fileExists) {
    throw new HttpError(404, 'Invoice not found');
  }

  const fileName = invoice.invoice_number + '.' + invoice.format;
  res.set('Content-Type', getContentType(invoice.format));
  res.set('Content-Disposition', 'inline; filename="' + fileName + '"');
  res.set('Cache-Control', 'private, no-store');

  const fileStream = storage.createReadStream(invoice.storage_key);
  fileStream.on('error', next);
  fileStream.pipe(res);
}
