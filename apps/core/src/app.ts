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
  // --- module mounts (one line per module; owners uncomment their own line) ---
  v1.use('/audit-logs', createAuditRouter({ authService: deps.authService, auditService: deps.auditService }));
  // M1 taxes:               v1.use('/taxes', createTaxesRouter({ authService: deps.authService, taxesService: deps.taxesService }));
  // M2 payment-terms:       v1.use('/payment-terms', createPaymentTermsRouter({ authService: deps.authService, paymentTermsService: deps.paymentTermsService }));
  // M3 products:            v1.use('/products', createProductsRouter({ authService: deps.authService, productsService: deps.productsService }));
  // M4 staff:               v1.use('/staff', createStaffRouter({ authService: deps.authService, staffService: deps.staffService }));
  // M5 customers:           v1.use('/customers', createCustomersRouter({ authService: deps.authService, customersService: deps.customersService }));
  // M6 plans:               v1.use('/plans', createPlansRouter({ authService: deps.authService, plansService: deps.plansService }));
  // M7 discounts:           v1.use('/discounts', createDiscountsRouter({ authService: deps.authService, discountsService: deps.discountsService }));
  // M8 quotation-templates: v1.use('/quotation-templates', createQuotationTemplatesRouter({ authService: deps.authService, quotationTemplatesService: deps.quotationTemplatesService }));
  // M9 subscriptions:       v1.use('/subscriptions', createSubscriptionsRouter({ authService: deps.authService, subscriptionsService: deps.subscriptionsService }));
  // M10 invoices:           v1.use('/invoices', createInvoicesRouter({ authService: deps.authService, invoicesService: deps.invoicesService }));
  // M12 payments:           v1.use('/payments', createPaymentsRouter({ authService: deps.authService, paymentsService: deps.paymentsService }));
  // M11 billing-runs:       v1.use('/billing-runs', createBillingRunsRouter({ authService: deps.authService, billingRunsService: deps.billingRunsService }));
  // M13 portal (owns /portal and /me, never mounted at '/'):
  //   v1.use('/portal', createPortalRouter({ authService: deps.authService, portalService: deps.portalService }));
  //   v1.use('/me', createPortalProfileRouter({ authService: deps.authService, portalService: deps.portalService }));
  // M14 reports:            v1.use('/reports', createReportsRouter({ authService: deps.authService, reportsService: deps.reportsService }));
  // --- end module mounts ---
  app.use('/api/v1', v1);

  // ---- errors ----
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, deps };
}
