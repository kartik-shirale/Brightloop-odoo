import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { idParamsSchema } from '../../core/utils/list-query.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import {
  createBillingRunSchema, listBillingRunItemsQuerySchema, listBillingRunsQuerySchema,
} from './billing-runs.schema.js';
import type { BillingRunsService } from './billing-runs.service.js';

export interface BillingRunsRouterDeps {
  authService: AuthService;
  billingRunsService: BillingRunsService;
}

export function createBillingRunsRouter({ authService, billingRunsService }: BillingRunsRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listBillingRunsQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await billingRunsService.list(actorFromUser(req.user!), validated(res, 'query', listBillingRunsQuerySchema));
      respondOk(res, 'Billing runs fetched.', result.runs, result.meta);
    }),
  );

  // 201 with the RUNNING run; the client polls GET /:id until it finishes.
  router.post(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateBody(createBillingRunSchema),
    asyncHandler(async (req, res) => {
      const run = await billingRunsService.create(actorFromUser(req.user!), validated(res, 'body', createBillingRunSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${run.id}`);
      respondCreated(res, 'Billing run started.', run);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Billing run fetched.', await billingRunsService.get(actorFromUser(req.user!), id));
    }),
  );

  router.get(
    '/:id/items',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateQuery(listBillingRunItemsQuerySchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const result = await billingRunsService.listItems(
        actorFromUser(req.user!), id, validated(res, 'query', listBillingRunItemsQuerySchema),
      );
      respondOk(res, 'Billing run items fetched.', result.items, result.meta);
    }),
  );

  router.post(
    '/:id/retry-failed',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Billing run retry started.', await billingRunsService.retryFailed(actorFromUser(req.user!), id, req.ip));
    }),
  );

  return router;
}
