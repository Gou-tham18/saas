import { redis } from './redis.js';
import { logger } from './logger.js';

export async function getOrSet(key, ttlSeconds, loadValue) {
  try {
    const cachedValue = await redis.get(key);
    if (cachedValue !== null) {
      return { value: JSON.parse(cachedValue), cached: true };
    }
  } catch (err) {
    logger.warn({ err: err.message, key: key }, 'Cache read failed; falling back to source');
  }

  const value = await loadValue();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err: err.message, key: key }, 'Cache write failed');
  }

  return { value: value, cached: false };
}

export async function invalidate(pattern) {
  try {
    let cursor = '0';
    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];
      if (keys.length > 0) {
        await redis.del(keys);
      }
    } while (cursor !== '0');
  } catch (err) {
    logger.warn({ err: err.message, pattern: pattern }, 'Cache invalidation failed');
  }
}
