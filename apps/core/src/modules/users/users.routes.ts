import { Role } from '@brightloop/shared';
/**
 * Users HTTP layer (plain Express router).
 *
 * RBAC: list/stats → admin+staff, read/update/delete self or admin.
 */

import { Router, type Request, type Response, type Router as RouterType } from 'express';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { respondOk } from '../../core/utils/response.js';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import {
  changePasswordSchema,
  listUsersQuerySchema,
  updateMeSchema,
  userIdParamsSchema,
} from './users.schema.js';
import type { AuthService } from '../auth/auth.service.js';
import type { UsersService } from './users.service.js';

export interface UsersRouterDeps {
  usersService: UsersService;
  authService: AuthService;
}

export function createUsersRouter({ usersService, authService }: UsersRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  /** GET /api/v1/users — paginated, searchable, sorted, filtered list. */
  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listUsersQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await usersService.list(validated(res, 'query', listUsersQuerySchema));
      respondOk(res, 'Users fetched.', result.users, result.meta);
    }),
  );

  /** GET /api/v1/users/stats — admin/staff dashboard counters. */
  router.get(
    '/stats',
    requireRoles(Role.ADMIN, Role.STAFF),
    asyncHandler(async (_req: Request, res: Response) => {
      const stats = await usersService.stats();
      respondOk(res, 'User stats fetched.', stats);
    }),
  );

  /** GET /api/v1/users/me — the signed-in user's own profile. */
  router.get(
    '/me',
    asyncHandler(async (req: Request, res: Response) => {
      const me = await usersService.getById(req.user!.id);
      respondOk(res, 'Profile fetched.', me);
    }),
  );

  /** PATCH /api/v1/users/me — update own profile (name/username). */
  router.patch(
    '/me',
    validateBody(updateMeSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const me = await usersService.updateMe(req.user!, validated(res, 'body', updateMeSchema));
      respondOk(res, 'Profile updated.', me);
    }),
  );

  /** POST /api/v1/users/me/password — rotate own password, revoke other sessions. */
  router.post(
    '/me/password',
    validateBody(changePasswordSchema),
    asyncHandler(async (req: Request, res: Response) => {
      await usersService.changePassword(req.user!, validated(res, 'body', changePasswordSchema));
      respondOk(res, 'Password updated. Other sessions were signed out.');
    }),
  );

  /** GET /api/v1/users/:id — self or admin/staff. */
  router.get(
    '/:id',
    validateParams(userIdParamsSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const id = validated(res, 'params', userIdParamsSchema).id;
      const user = await usersService.getForViewer(req.user!, id);
      respondOk(res, 'User fetched.', user);
    }),
  );

  return router;
}
