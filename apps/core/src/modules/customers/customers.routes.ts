import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { idParamsSchema } from '../../core/utils/list-query.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import { createCustomerSchema, listCustomersQuerySchema, updateCustomerSchema } from './customers.schema.js';
import type { CustomersService } from './customers.service.js';

export interface CustomersRouterDeps {
  authService: AuthService;
  customersService: CustomersService;
}

export function createCustomersRouter({ authService, customersService }: CustomersRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listCustomersQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await customersService.list(actorFromUser(req.user!), validated(res, 'query', listCustomersQuerySchema));
      respondOk(res, 'Customers fetched.', result.customers, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateBody(createCustomerSchema),
    asyncHandler(async (req, res) => {
      const customer = await customersService.create(actorFromUser(req.user!), validated(res, 'body', createCustomerSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${customer.id}`);
      respondCreated(res, 'Customer created.', customer);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Customer fetched.', await customersService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateBody(updateCustomerSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const customer = await customersService.update(actorFromUser(req.user!), id, validated(res, 'body', updateCustomerSchema), req.ip);
      respondOk(res, 'Customer updated.', customer);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await customersService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Customer deleted.');
    }),
  );

  return router;
}
