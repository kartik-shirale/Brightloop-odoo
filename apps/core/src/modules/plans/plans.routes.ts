import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { idParamsSchema } from '../../core/utils/list-query.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import { createPlanSchema, listPlansQuerySchema, updatePlanSchema } from './plans.schema.js';
import type { PlansService } from './plans.service.js';

export interface PlansRouterDeps {
  authService: AuthService;
  plansService: PlansService;
}

export function createPlansRouter({ authService, plansService }: PlansRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listPlansQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await plansService.list(actorFromUser(req.user!), validated(res, 'query', listPlansQuerySchema));
      respondOk(res, 'Plans fetched.', result.plans, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN),
    validateBody(createPlanSchema),
    asyncHandler(async (req, res) => {
      const plan = await plansService.create(actorFromUser(req.user!), validated(res, 'body', createPlanSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${plan.id}`);
      respondCreated(res, 'Plan created.', plan);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Plan fetched.', await plansService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    validateBody(updatePlanSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const plan = await plansService.update(actorFromUser(req.user!), id, validated(res, 'body', updatePlanSchema), req.ip);
      respondOk(res, 'Plan updated.', plan);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await plansService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Plan deleted.');
    }),
  );

  return router;
}
