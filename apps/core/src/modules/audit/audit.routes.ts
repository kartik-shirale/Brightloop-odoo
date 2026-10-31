import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import { listAuditLogsQuerySchema } from './audit.schema.js';
import type { AuditService } from './audit.service.js';

export interface AuditRouterDeps {
  authService: AuthService;
  auditService: AuditService;
}

export function createAuditRouter({ authService, auditService }: AuditRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN),
    validateQuery(listAuditLogsQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await auditService.list(
        actorFromUser(req.user!),
        validated(res, 'query', listAuditLogsQuerySchema),
      );
      respondOk(res, 'Audit logs fetched.', result.logs, result.meta);
    }),
  );

  return router;
}
