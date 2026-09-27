import { getOrSet, invalidate } from '../lib/cache.js';
import { config } from '../config/env.js';
import {
  getSubscriberStats,
  getRevenueStats,
  getPlanStats,
  getDailyRevenue,
  findExpiringSubscriptions,
} from '../models/metricsModel.js';

const CACHE_PREFIX = 'metrics:';

async function calculateSummary() {
  const subscriberStats = await getSubscriberStats(config.REMINDER_DAYS_BEFORE_EXPIRY);
  const revenueStats = await getRevenueStats();
  const planStats = await getPlanStats();

  return {
    generatedAt: new Date().toISOString(),
    currency: 'usd',
    subscribers: {
      active: subscriberStats.active_subscribers,
      activeSubscriptions: subscriberStats.active_subscriptions,
      expiringWithinDays: {
        days: config.REMINDER_DAYS_BEFORE_EXPIRY,
        count: subscriberStats.expiring_soon,
      },
      pendingCancellation: subscriberStats.pending_cancellation,
      newUsersLast30Days: revenueStats.new_users_30d,
    },
    revenue: {
      simulated: true,
      totalCents: revenueStats.total_cents,
      last30DaysCents: revenueStats.last_30d_cents,
      monthToDateCents: revenueStats.month_to_date_cents,
      mrrCents: subscriberStats.mrr_cents,
      arrCents: subscriberStats.mrr_cents * 12,
      paymentCount: revenueStats.payment_count,
    },
    plans: planStats,
  };
}

async function calculateDailyRevenue(days) {
  const rows = await getDailyRevenue(days);
  const series = [];
  for (const row of rows) {
    series.push({
      day: row.day,
      revenueCents: row.revenue_cents,
      payments: row.payments,
    });
  }
  return series;
}

export async function getPlatformSummary() {
  const cacheKey = CACHE_PREFIX + 'summary';
  return await getOrSet(cacheKey, config.METRICS_CACHE_TTL_SECONDS, calculateSummary);
}

export async function getRevenueByDay(days) {
  const cacheKey = CACHE_PREFIX + 'revenue:daily:' + days;
  return await getOrSet(cacheKey, config.METRICS_CACHE_TTL_SECONDS, () => calculateDailyRevenue(days));
}

export async function getExpiringSubscriptions(days, limit = 50) {
  return await findExpiringSubscriptions(days, limit);
}

export async function invalidateMetricsCache() {
  await invalidate(CACHE_PREFIX + '*');
}
