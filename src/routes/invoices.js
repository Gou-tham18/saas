import { Router } from 'express';
import { downloadInvoice } from '../controllers/invoiceController.js';

export const invoiceRouter = Router();

invoiceRouter.get('/:invoiceNumber/download', downloadInvoice);
