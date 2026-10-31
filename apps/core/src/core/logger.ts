/**
 * Structured pino logger for the whole app (backend-rules.md #9).
 * Never `console.log` in feature code — import `logger`.
 */
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.confirmPassword',
      '*.password',
      '*.confirmPassword',
      '*.otp',
      '*.passwordHash',
    ],
    censor: '[redacted]',
  },
});

export type Logger = pino.Logger;
