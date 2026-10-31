import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import {
  createProductSchema,
  createVariantSchema,
  listProductsQuerySchema,
  listVariantsQuerySchema,
  productIdParamsSchema,
  updateProductSchema,
  updateVariantSchema,
  variantParamsSchema,
  variantsParentParamsSchema,
} from './products.schema.js';
import type { ProductsService } from './products.service.js';

export interface ProductsRouterDeps {
  authService: AuthService;
  productsService: ProductsService;
}

export function createProductsRouter({ authService, productsService }: ProductsRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listProductsQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await productsService.list(actorFromUser(req.user!), validated(res, 'query', listProductsQuerySchema));
      respondOk(res, 'Products fetched.', result.products, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN),
    validateBody(createProductSchema),
    asyncHandler(async (req, res) => {
      const product = await productsService.create(actorFromUser(req.user!), validated(res, 'body', createProductSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${product.id}`);
      respondCreated(res, 'Product created.', product);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(productIdParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', productIdParamsSchema);
      respondOk(res, 'Product fetched.', await productsService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(productIdParamsSchema),
    validateBody(updateProductSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', productIdParamsSchema);
      const product = await productsService.update(actorFromUser(req.user!), id, validated(res, 'body', updateProductSchema), req.ip);
      respondOk(res, 'Product updated.', product);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(productIdParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', productIdParamsSchema);
      await productsService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Product deleted.');
    }),
  );

  router.get(
    '/:productId/variants',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(variantsParentParamsSchema),
    validateQuery(listVariantsQuerySchema),
    asyncHandler(async (req, res) => {
      const { productId } = validated(res, 'params', variantsParentParamsSchema);
      const result = await productsService.listVariants(actorFromUser(req.user!), productId, validated(res, 'query', listVariantsQuerySchema));
      respondOk(res, 'Variants fetched.', result.variants, result.meta);
    }),
  );

  router.post(
    '/:productId/variants',
    requireRoles(Role.ADMIN),
    validateParams(variantsParentParamsSchema),
    validateBody(createVariantSchema),
    asyncHandler(async (req, res) => {
      const { productId } = validated(res, 'params', variantsParentParamsSchema);
      const variant = await productsService.createVariant(actorFromUser(req.user!), productId, validated(res, 'body', createVariantSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${productId}/variants/${variant.id}`);
      respondCreated(res, 'Variant created.', variant);
    }),
  );

  router.patch(
    '/:productId/variants/:variantId',
    requireRoles(Role.ADMIN),
    validateParams(variantParamsSchema),
    validateBody(updateVariantSchema),
    asyncHandler(async (req, res) => {
      const { productId, variantId } = validated(res, 'params', variantParamsSchema);
      const variant = await productsService.updateVariant(actorFromUser(req.user!), productId, variantId, validated(res, 'body', updateVariantSchema), req.ip);
      respondOk(res, 'Variant updated.', variant);
    }),
  );

  router.delete(
    '/:productId/variants/:variantId',
    requireRoles(Role.ADMIN),
    validateParams(variantParamsSchema),
    asyncHandler(async (req, res) => {
      const { productId, variantId } = validated(res, 'params', variantParamsSchema);
      await productsService.removeVariant(actorFromUser(req.user!), productId, variantId, req.ip);
      respondOk(res, 'Variant deleted.');
    }),
  );

  return router;
}
