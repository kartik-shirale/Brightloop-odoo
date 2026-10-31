import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import {
  agingQuerySchema, listExpiringQuerySchema, listOverdueQuerySchema, rangeQuerySchema, summaryQuerySchema,
  timeseriesQuerySchema,
} from './reports.schema.js';
import type { ReportsService } from './reports.service.js';

export interface ReportsRouterDeps {
  authService: AuthService;
  reportsService: ReportsService;
}

/** Read-only reports, all GET, ADMIN and STAFF only. */
export function createReportsRouter({ authService, reportsService }: ReportsRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));
  const staff = requireRoles(Role.ADMIN, Role.STAFF);

  router.get(
    '/summary',
    staff,
    validateQuery(summaryQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', summaryQuerySchema);
      respondOk(res, 'Summary report fetched.', await reportsService.summary(actorFromUser(req.user!), query));
    }),
  );

  router.get(
    '/revenue/timeseries',
    staff,
    validateQuery(timeseriesQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', timeseriesQuerySchema);
      respondOk(res, 'Revenue timeseries fetched.', await reportsService.revenueTimeseries(actorFromUser(req.user!), query));
    }),
  );

  router.get(
    '/revenue/by-plan',
    staff,
    validateQuery(rangeQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', rangeQuerySchema);
      respondOk(res, 'Revenue by plan fetched.', await reportsService.revenueByPlan(actorFromUser(req.user!), query));
    }),
  );

  router.get(
    '/payments/summary',
    staff,
    validateQuery(rangeQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', rangeQuerySchema);
      respondOk(res, 'Payments summary fetched.', await reportsService.paymentsSummary(actorFromUser(req.user!), query));
    }),
  );

  router.get(
    '/invoices/overdue',
    staff,
    validateQuery(listOverdueQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', listOverdueQuerySchema);
      const result = await reportsService.listOverdueInvoices(actorFromUser(req.user!), query);
      respondOk(res, 'Overdue invoices fetched.', result.invoices, result.meta);
    }),
  );

  router.get(
    '/aging',
    staff,
    validateQuery(agingQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', agingQuerySchema);
      respondOk(res, 'Aging report fetched.', await reportsService.aging(actorFromUser(req.user!), query));
    }),
  );

  router.get(
    '/subscriptions/expiring',
    staff,
    validateQuery(listExpiringQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', listExpiringQuerySchema);
      const result = await reportsService.listExpiringSubscriptions(actorFromUser(req.user!), query);
      respondOk(res, 'Expiring subscriptions fetched.', result.subscriptions, result.meta);
    }),
  );

  return router;
}
