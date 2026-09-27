import { Router } from 'express';
import { requireAdmin } from '../middleware/index.js';
import {
  getMetricsSummary,
  getRevenueSeries,
  getUser,
  listExpiringSubscriptions,
} from '../controllers/adminController.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/metrics/summary', getMetricsSummary);
adminRouter.get('/metrics/revenue', getRevenueSeries);
adminRouter.get('/subscriptions/expiring', listExpiringSubscriptions);
adminRouter.get('/users/:email', getUser);
