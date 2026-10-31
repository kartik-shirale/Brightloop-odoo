/**
 * Express app setup (backend-rules.md #1, #8): helmet, CORS, JSON limits,
 * cookies, request ids, rate limiting, routes, error handler.
 */

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import hpp from 'hpp';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './core/middlewares/error-handler.js';
import { createRateLimiter } from './core/middlewares/rate-limit.js';
import { requestContext } from './core/middlewares/request-context.js';
import { getKvStore, type KvStore } from './config/redis.js';
import { createAuditRouter } from './modules/audit/audit.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createUsersRouter } from './modules/users/users.routes.js';
import { buildServices, type AppServices } from './container.js';
import { logger } from './core/logger.js';

export function createApp(services?: AppServices, kv: KvStore = getKvStore()): { app: Express; deps: AppServices } {
  const app = express();
  const deps = services ?? buildServices();

  // ---- security & body parsing ----
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(hpp());
  app.use(requestContext());

  // ---- health & readiness ----
  app.get(['/health', '/api/health'], (_req, res) => {
    res.json({ ok: true, service: '@odoo/core', timestamp: new Date().toISOString() });
  });
  app.get(['/ready', '/api/ready'], async (_req, res) => {
    try {
      await Promise.all([deps.authRepository.checkHealth(), kv.get('app:ready')]);
      res.json({ ok: true, db: 'ok', redis: 'ok' });
    } catch (error) {
      logger.error({ err: error }, 'Readiness check failed');
      res.status(503).json({ ok: false, message: 'Database or Redis unavailable' });
    }
  });

  // ---- API v1 ----
  const v1 = express.Router();
  v1.use(createRateLimiter({ scope: 'global', max: 100, windowSeconds: 900, store: kv }));
  v1.use('/auth', createAuthRouter({ authService: deps.authService, rateLimiter:
    createRateLimiter({ scope: 'otp', max: 30, windowSeconds: 900, store: kv }) }));
  v1.use('/users', createUsersRouter({ usersService: deps.usersService, authService: deps.authService }));
  // --- module mounts ---
  v1.use('/audit-logs', createAuditRouter({ authService: deps.authService, auditService: deps.auditService }));
  // --- end module mounts ---
  app.use('/api/v1', v1);

  // ---- errors ----
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, deps };
}
