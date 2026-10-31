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
  createPaymentTermSchema,
  listPaymentTermsQuerySchema,
  updatePaymentTermSchema,
} from './payment-terms.schema.js';
import type { PaymentTermsService } from './payment-terms.service.js';

export interface PaymentTermsRouterDeps {
  authService: AuthService;
  paymentTermsService: PaymentTermsService;
}

export function createPaymentTermsRouter({ authService, paymentTermsService }: PaymentTermsRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listPaymentTermsQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await paymentTermsService.list(
        actorFromUser(req.user!),
        validated(res, 'query', listPaymentTermsQuerySchema),
      );
      respondOk(res, 'Payment terms fetched.', result.paymentTerms, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN),
    validateBody(createPaymentTermSchema),
    asyncHandler(async (req, res) => {
      const term = await paymentTermsService.create(
        actorFromUser(req.user!),
        validated(res, 'body', createPaymentTermSchema),
        req.ip,
      );
      res.setHeader('Location', `${req.baseUrl}/${term.id}`);
      respondCreated(res, 'Payment term created.', term);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Payment term fetched.', await paymentTermsService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    validateBody(updatePaymentTermSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const term = await paymentTermsService.update(
        actorFromUser(req.user!),
        id,
        validated(res, 'body', updatePaymentTermSchema),
        req.ip,
      );
      respondOk(res, 'Payment term updated.', term);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await paymentTermsService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Payment term deleted.');
    }),
  );

  return router;
}
