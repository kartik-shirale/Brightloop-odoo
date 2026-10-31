import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import type { AuthenticatedUser } from '../../core/types/express.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { idParamsSchema } from '../../core/utils/list-query.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import {
  listPortalInvoicesQuerySchema, listPortalPaymentsQuerySchema, listPortalSubscriptionsQuerySchema,
  portalCloseSubscriptionSchema, portalRenewSubscriptionSchema, updatePortalProfileSchema,
} from './portal.schema.js';
import type { PortalCaller, PortalService } from './portal.service.js';

export interface PortalRouterDeps {
  authService: AuthService;
  portalService: PortalService;
}

const callerOf = (user: AuthenticatedUser): PortalCaller => ({ userId: user.id, role: user.role, email: user.email });

/** Mounted at `/api/v1/portal`. CUSTOMER only on every route. */
export function createPortalRouter({ authService, portalService }: PortalRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));
  router.use(requireRoles(Role.CUSTOMER));

  router.get(
    '/summary',
    asyncHandler(async (req, res) => {
      respondOk(res, 'Summary fetched.', await portalService.summary(callerOf(req.user!)));
    }),
  );

  router.get(
    '/subscriptions',
    validateQuery(listPortalSubscriptionsQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', listPortalSubscriptionsQuerySchema);
      const result = await portalService.listSubscriptions(callerOf(req.user!), query);
      respondOk(res, 'Subscriptions fetched.', result.subscriptions, result.meta);
    }),
  );

  router.get(
    '/subscriptions/:id',
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Subscription fetched.', await portalService.getSubscription(callerOf(req.user!), id));
    }),
  );

  router.post(
    '/subscriptions/:id/pause',
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Subscription paused.', await portalService.pauseSubscription(callerOf(req.user!), id, req.ip));
    }),
  );

  router.post(
    '/subscriptions/:id/resume',
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Subscription resumed.', await portalService.resumeSubscription(callerOf(req.user!), id, req.ip));
    }),
  );

  router.post(
    '/subscriptions/:id/close',
    validateParams(idParamsSchema),
    validateBody(portalCloseSubscriptionSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const input = validated(res, 'body', portalCloseSubscriptionSchema);
      respondOk(res, 'Subscription closed.', await portalService.closeSubscription(callerOf(req.user!), id, input, req.ip));
    }),
  );

  router.post(
    '/subscriptions/:id/renew',
    validateParams(idParamsSchema),
    validateBody(portalRenewSubscriptionSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const subscription = await portalService.renewSubscription(callerOf(req.user!), id, req.ip);
      res.setHeader('Location', `${req.baseUrl}/subscriptions/${subscription.id}`);
      respondCreated(res, 'Subscription renewed.', subscription);
    }),
  );

  router.get(
    '/invoices',
    validateQuery(listPortalInvoicesQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', listPortalInvoicesQuerySchema);
      const result = await portalService.listInvoices(callerOf(req.user!), query);
      respondOk(res, 'Invoices fetched.', result.invoices, result.meta);
    }),
  );

  router.get(
    '/invoices/:id',
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Invoice fetched.', await portalService.getInvoice(callerOf(req.user!), id));
    }),
  );

  router.get(
    '/invoices/:id/print',
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Invoice print data fetched.', await portalService.printInvoice(callerOf(req.user!), id));
    }),
  );

  router.get(
    '/payments',
    validateQuery(listPortalPaymentsQuerySchema),
    asyncHandler(async (req, res) => {
      const query = validated(res, 'query', listPortalPaymentsQuerySchema);
      const result = await portalService.listPayments(callerOf(req.user!), query);
      respondOk(res, 'Payments fetched.', result.payments, result.meta);
    }),
  );

  return router;
}

/** Mounted at `/api/v1/me`. CUSTOMER only. Password change stays in auth. */
export function createPortalProfileRouter({ authService, portalService }: PortalRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));
  router.use(requireRoles(Role.CUSTOMER));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      respondOk(res, 'Profile fetched.', await portalService.getProfile(callerOf(req.user!)));
    }),
  );

  router.patch(
    '/',
    validateBody(updatePortalProfileSchema),
    asyncHandler(async (req, res) => {
      const input = validated(res, 'body', updatePortalProfileSchema);
      respondOk(res, 'Profile updated.', await portalService.updateProfile(callerOf(req.user!), input, req.ip));
    }),
  );

  return router;
}
