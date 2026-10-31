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
  attachDiscountSubscriptionsSchema, createDiscountSchema, discountSubscriptionParamsSchema,
  listDiscountUsagesQuerySchema, listDiscountsQuerySchema, setDiscountProductsSchema, updateDiscountSchema,
} from './discounts.schema.js';
import type { DiscountsService } from './discounts.service.js';

export interface DiscountsRouterDeps {
  authService: AuthService;
  discountsService: DiscountsService;
}

export function createDiscountsRouter({ authService, discountsService }: DiscountsRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listDiscountsQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await discountsService.list(actorFromUser(req.user!), validated(res, 'query', listDiscountsQuerySchema));
      respondOk(res, 'Discounts fetched.', result.discounts, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN),
    validateBody(createDiscountSchema),
    asyncHandler(async (req, res) => {
      const discount = await discountsService.create(actorFromUser(req.user!), validated(res, 'body', createDiscountSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${discount.id}`);
      respondCreated(res, 'Discount created.', discount);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Discount fetched.', await discountsService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    validateBody(updateDiscountSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const discount = await discountsService.update(actorFromUser(req.user!), id, validated(res, 'body', updateDiscountSchema), req.ip);
      respondOk(res, 'Discount updated.', discount);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await discountsService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Discount deleted.');
    }),
  );

  router.put(
    '/:id/products',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    validateBody(setDiscountProductsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const { productIds } = validated(res, 'body', setDiscountProductsSchema);
      respondOk(res, 'Discount products updated.', await discountsService.setProducts(actorFromUser(req.user!), id, productIds, req.ip));
    }),
  );

  router.post(
    '/:id/subscriptions',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateBody(attachDiscountSubscriptionsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const { subscriptionIds } = validated(res, 'body', attachDiscountSubscriptionsSchema);
      const discount = await discountsService.attachSubscriptions(actorFromUser(req.user!), id, subscriptionIds, req.ip);
      respondOk(res, 'Discount attached.', discount);
    }),
  );

  router.delete(
    '/:id/subscriptions/:subscriptionId',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(discountSubscriptionParamsSchema),
    asyncHandler(async (req, res) => {
      const { id, subscriptionId } = validated(res, 'params', discountSubscriptionParamsSchema);
      await discountsService.detachSubscription(actorFromUser(req.user!), id, subscriptionId, req.ip);
      respondOk(res, 'Discount detached.');
    }),
  );

  router.get(
    '/:id/usages',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateQuery(listDiscountUsagesQuerySchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const result = await discountsService.listUsages(actorFromUser(req.user!), id, validated(res, 'query', listDiscountUsagesQuerySchema));
      respondOk(res, 'Discount usages fetched.', result.usages, result.meta);
    }),
  );

  return router;
}
