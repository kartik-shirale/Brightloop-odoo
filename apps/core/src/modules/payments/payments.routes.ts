import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { idParamsSchema } from '../../core/utils/list-query.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import { createPaymentSchema, listPaymentsQuerySchema, updatePaymentSchema } from './payments.schema.js';
import type { PaymentsService } from './payments.service.js';

export interface PaymentsRouterDeps {
  authService: AuthService;
  paymentsService: PaymentsService;
}

export function createPaymentsRouter({ authService, paymentsService }: PaymentsRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listPaymentsQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await paymentsService.list(actorFromUser(req.user!), validated(res, 'query', listPaymentsQuerySchema));
      respondOk(res, 'Payments fetched.', result.payments, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateBody(createPaymentSchema),
    asyncHandler(async (req, res) => {
      const payment = await paymentsService.create(actorFromUser(req.user!), validated(res, 'body', createPaymentSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${payment.id}`);
      respondCreated(res, 'Payment recorded.', payment);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Payment fetched.', await paymentsService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateBody(updatePaymentSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const payment = await paymentsService.update(actorFromUser(req.user!), id, validated(res, 'body', updatePaymentSchema), req.ip);
      respondOk(res, 'Payment updated.', payment);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await paymentsService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Payment deleted.');
    }),
  );

  return router;
}
