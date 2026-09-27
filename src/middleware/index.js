import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { HttpError } from '../lib/httpError.js';

export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fieldErrors = z.flattenError(result.error).fieldErrors;
    throw new HttpError(400, 'Validation failed', fieldErrors);
  }
  return result.data;
}

export function requireAdmin(req, res, next) {
  if (!config.ADMIN_API_KEY) {
    return next();
  }

  let givenKey = req.get('x-api-key');
  if (!givenKey) {
    givenKey = '';
  }

  const given = Buffer.from(givenKey);
  const expected = Buffer.from(config.ADMIN_API_KEY);

  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return next(new HttpError(401, 'Invalid or missing x-api-key'));
  }
  next();
}

export function requestLogger(req, res, next) {
  const startTime = Date.now();

  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    const duration = Date.now() - startTime;
    logger.info({ method: req.method, path: path, status: res.statusCode, ms: duration }, 'request');
  });

  next();
}

export function notFound(req, res, next) {
  next(new HttpError(404, 'Route not found: ' + req.method + ' ' + req.path));
}

export function errorHandler(err, req, res, next) {
  let status = 500;
  if (err.status) {
    status = err.status;
  } else if (err.statusCode) {
    status = err.statusCode;
  }

  if (status >= 500) {
    logger.error({ err, path: req.path }, 'Unhandled error');
  }

  let message = err.message;
  if (status >= 500 && config.isProd) {
    message = 'Internal server error';
  }

  const response = { error: message };
  if (err.details) {
    response.details = err.details;
  }

  res.status(status).json(response);
}
