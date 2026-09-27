import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentFolder = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(currentFolder, '../..');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

function toBoolean(value) {
  return value === 'true' || value === '1';
}

const booleanText = z.enum(['true', 'false', '1', '0']).transform(toBoolean);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1).default('postgres://saas:saas@localhost:5432/saas'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  CHECKOUT_SUCCESS_URL: z.string().optional(),
  CHECKOUT_CANCEL_URL: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('SaaS Platform <billing@saas.local>'),
  ATTACH_INVOICE_TO_EMAIL: booleanText.default(true),

  INVOICE_STORAGE_DIR: z.string().default('storage/invoices'),
  INVOICE_FORMAT: z.enum(['pdf', 'txt']).default('pdf'),

  EXPIRY_SCAN_CRON: z.string().default('0 * * * *'),
  REMINDER_DAYS_BEFORE_EXPIRY: z.coerce.number().int().positive().default(3),
  CRON_TIMEZONE: z.string().default('UTC'),

  METRICS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  ENABLE_DEV_ROUTES: booleanText.default(true),
  ADMIN_API_KEY: z.string().optional(),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid environment configuration:\n' + z.prettifyError(result.error));
  process.exit(1);
}

export const config = result.data;

config.isProd = config.NODE_ENV === 'production';
config.stripeEnabled = Boolean(config.STRIPE_SECRET_KEY);
config.invoiceDir = path.resolve(ROOT_DIR, config.INVOICE_STORAGE_DIR);

if (config.CHECKOUT_SUCCESS_URL) {
  config.checkoutSuccessUrl = config.CHECKOUT_SUCCESS_URL;
} else {
  config.checkoutSuccessUrl = config.APP_BASE_URL + '/api/checkout/success?session_id={CHECKOUT_SESSION_ID}';
}

if (config.CHECKOUT_CANCEL_URL) {
  config.checkoutCancelUrl = config.CHECKOUT_CANCEL_URL;
} else {
  config.checkoutCancelUrl = config.APP_BASE_URL + '/api/checkout/cancel';
}

if (config.isProd && config.ENABLE_DEV_ROUTES) {
  console.error('ENABLE_DEV_ROUTES must be false in production');
  process.exit(1);
}
