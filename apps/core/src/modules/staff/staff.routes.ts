import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { idParamsSchema } from '../../core/utils/list-query.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import { createStaffSchema, listStaffQuerySchema, updateStaffSchema } from './staff.schema.js';
import type { StaffService } from './staff.service.js';

export interface StaffRouterDeps {
  authService: AuthService;
  staffService: StaffService;
}

export function createStaffRouter({ authService, staffService }: StaffRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN),
    validateQuery(listStaffQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await staffService.list(actorFromUser(req.user!), validated(res, 'query', listStaffQuerySchema));
      respondOk(res, 'Staff fetched.', result.staff, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN),
    validateBody(createStaffSchema),
    asyncHandler(async (req, res) => {
      const staff = await staffService.create(actorFromUser(req.user!), validated(res, 'body', createStaffSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${staff.id}`);
      respondCreated(res, 'Staff member created.', staff);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Staff member fetched.', await staffService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    validateBody(updateStaffSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const staff = await staffService.update(actorFromUser(req.user!), id, validated(res, 'body', updateStaffSchema), req.ip);
      respondOk(res, 'Staff member updated.', staff);
    }),
  );

  router.post(
    '/:id/deactivate',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Staff member deactivated.', await staffService.deactivate(actorFromUser(req.user!), id, req.ip));
    }),
  );

  router.post(
    '/:id/activate',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Staff member activated.', await staffService.activate(actorFromUser(req.user!), id, req.ip));
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await staffService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Staff member deleted.');
    }),
  );

  return router;
}
