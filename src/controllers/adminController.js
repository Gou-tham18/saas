import { z } from 'zod';
import { parse } from '../middleware/index.js';
import { HttpError } from '../lib/httpError.js';
import { getExpiringSubscriptions, getPlatformSummary, getRevenueByDay } from '../services/metricsService.js';
import { getUserOverview } from '../services/subscriptionService.js';

const revenueQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const expiringQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

function getCacheHeader(cached) {
  if (cached) {
    return 'HIT';
  }
  return 'MISS';
}

export async function getMetricsSummary(req, res) {
  const result = await getPlatformSummary();
  res.set('X-Cache', getCacheHeader(result.cached));
  res.json(result.value);
}

export async function getRevenueSeries(req, res) {
  const query = parse(revenueQuerySchema, req.query);
  const result = await getRevenueByDay(query.days);
  res.set('X-Cache', getCacheHeader(result.cached));
  res.json({ days: query.days, series: result.value });
}

export async function listExpiringSubscriptions(req, res) {
  const query = parse(expiringQuerySchema, req.query);
  const subscriptions = await getExpiringSubscriptions(query.days);
  res.json({ days: query.days, subscriptions: subscriptions });
}

export async function getUser(req, res) {
  const overview = await getUserOverview(req.params.email);
  if (!overview) {
    throw new HttpError(404, 'User not found');
  }
  res.json(overview);
}
