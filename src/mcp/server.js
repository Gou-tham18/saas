import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { formatMoney } from '../lib/money.js';
import { getExpiringSubscriptions, getPlatformSummary, getRevenueByDay } from '../services/metricsService.js';
import { getUserOverview } from '../services/subscriptionService.js';

const server = new McpServer({ name: 'saas-platform-analytics', version: '1.0.0' });

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

function successResponse(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResponse(err) {
  logger.error({ err }, 'MCP tool failed');
  return {
    isError: true,
    content: [{ type: 'text', text: 'Error: ' + err.message }],
  };
}

function money(cents, currency) {
  return { cents: cents, formatted: formatMoney(cents, currency) };
}

async function getActiveSubscribers() {
  try {
    const result = await getPlatformSummary();
    const summary = result.value;

    const byPlan = [];
    for (const plan of summary.plans) {
      byPlan.push({ plan: plan.name, activeSubscriptions: plan.active_subscriptions });
    }

    return successResponse({
      activeSubscribers: summary.subscribers.active,
      activeSubscriptions: summary.subscribers.activeSubscriptions,
      byPlan: byPlan,
      asOf: summary.generatedAt,
      servedFromCache: result.cached,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function getRevenueTotals() {
  try {
    const result = await getPlatformSummary();
    const summary = result.value;
    const revenue = summary.revenue;
    const currency = summary.currency;

    return successResponse({
      note: 'All figures are simulated - generated from test-mode payments, no real money.',
      totalRevenue: money(revenue.totalCents, currency),
      last30Days: money(revenue.last30DaysCents, currency),
      monthToDate: money(revenue.monthToDateCents, currency),
      mrr: money(revenue.mrrCents, currency),
      arr: money(revenue.arrCents, currency),
      paymentCount: revenue.paymentCount,
      asOf: summary.generatedAt,
      servedFromCache: result.cached,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function getSummary() {
  try {
    const result = await getPlatformSummary();
    const data = result.value;
    data.servedFromCache = result.cached;
    return successResponse(data);
  } catch (err) {
    return errorResponse(err);
  }
}

async function getDailyRevenue(input) {
  try {
    const result = await getRevenueByDay(input.days);
    return successResponse({ days: input.days, series: result.value });
  } catch (err) {
    return errorResponse(err);
  }
}

async function listExpiring(input) {
  try {
    const subscriptions = await getExpiringSubscriptions(input.days, input.limit);
    return successResponse({ days: input.days, count: subscriptions.length, subscriptions: subscriptions });
  } catch (err) {
    return errorResponse(err);
  }
}

async function lookupCustomer(input) {
  try {
    const overview = await getUserOverview(input.email);
    if (!overview) {
      return successResponse({ found: false, email: input.email });
    }
    return successResponse(overview);
  } catch (err) {
    return errorResponse(err);
  }
}

server.registerTool(
  'get_active_subscribers',
  {
    title: 'Active subscribers',
    description: 'Real-time count of active subscribers and subscriptions, with a per-plan breakdown.',
    annotations: READ_ONLY,
  },
  getActiveSubscribers,
);

server.registerTool(
  'get_revenue_totals',
  {
    title: 'Revenue totals',
    description: 'Simulated revenue totals (Stripe test mode / simulated payments): all-time, last 30 days, month-to-date, MRR and ARR.',
    annotations: READ_ONLY,
  },
  getRevenueTotals,
);

server.registerTool(
  'get_platform_summary',
  {
    title: 'Platform summary',
    description: 'Full KPI snapshot: subscribers, churn risk (expiring / pending cancellation), revenue and plan mix.',
    annotations: READ_ONLY,
  },
  getSummary,
);

server.registerTool(
  'get_revenue_by_day',
  {
    title: 'Daily revenue',
    description: 'Daily simulated revenue and payment counts for the last N days (zero-filled).',
    inputSchema: {
      days: z.number().int().min(1).max(365).default(30).describe('Number of days to include'),
    },
    annotations: READ_ONLY,
  },
  getDailyRevenue,
);

server.registerTool(
  'list_expiring_subscriptions',
  {
    title: 'Expiring subscriptions',
    description: 'Active subscriptions whose current billing period ends within the next N days.',
    inputSchema: {
      days: z.number().int().min(1).max(90).default(7).describe('Look-ahead window in days'),
      limit: z.number().int().min(1).max(200).default(50),
    },
    annotations: READ_ONLY,
  },
  listExpiring,
);

server.registerTool(
  'lookup_customer',
  {
    title: 'Look up customer',
    description: "A customer's profile, subscriptions and invoices, by email address.",
    inputSchema: {
      email: z.email().describe('Customer email address'),
    },
    annotations: READ_ONLY,
  },
  lookupCustomer,
);

async function shutdown() {
  try {
    await server.close();
    await pool.end();
    await redis.quit();
  } catch (err) {
    logger.error({ err }, 'Error while shutting down MCP server');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('MCP server ready on stdio');
