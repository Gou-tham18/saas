import { Redis } from 'ioredis';
import { config } from '../config/env.js';
import { logger } from './logger.js';

export function createRedisConnection(options = {}) {
  let name = 'app';
  if (options.name) {
    name = options.name;
  }

  let maxRetriesPerRequest = 2;
  if (options.forBullMQ) {
    maxRetriesPerRequest = null;
  }

  const client = new Redis(config.REDIS_URL, {
    connectionName: 'saas:' + name,
    maxRetriesPerRequest: maxRetriesPerRequest,
    enableReadyCheck: true,
  });

  client.on('error', (err) => {
    logger.error({ err: err.message, connection: name }, 'Redis error');
  });

  return client;
}

export const redis = createRedisConnection({ name: 'cache' });
