import pino from 'pino';
import { config } from '../config/env.js';

let logLevel = config.LOG_LEVEL;
if (config.NODE_ENV === 'test') {
  logLevel = 'silent';
}

const STDERR = 2;

export const logger = pino(
  {
    level: logLevel,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination(STDERR),
);
