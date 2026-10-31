import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { idParamsSchema } from '../../core/utils/list-query.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import { createTaxSchema, listTaxesQuerySchema, updateTaxSchema } from './taxes.schema.js';
import type { TaxesService } from './taxes.service.js';

export interface TaxesRouterDeps {
  authService: AuthService;
  taxesService: TaxesService;
}

export function createTaxesRouter({ authService, taxesService }: TaxesRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listTaxesQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await taxesService.list(actorFromUser(req.user!), validated(res, 'query', listTaxesQuerySchema));
      respondOk(res, 'Taxes fetched.', result.taxes, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN),
    validateBody(createTaxSchema),
    asyncHandler(async (req, res) => {
      const tax = await taxesService.create(actorFromUser(req.user!), validated(res, 'body', createTaxSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${tax.id}`);
      respondCreated(res, 'Tax created.', tax);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Tax fetched.', await taxesService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    validateBody(updateTaxSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const tax = await taxesService.update(actorFromUser(req.user!), id, validated(res, 'body', updateTaxSchema), req.ip);
      respondOk(res, 'Tax updated.', tax);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await taxesService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Tax deleted.');
    }),
  );

  return router;
}
