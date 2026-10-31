import { Role } from '@brightloop/shared';
import { Router, type Router as RouterType } from 'express';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { actorFromUser } from '../../core/utils/actor.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { idParamsSchema } from '../../core/utils/list-query.js';
import { respondCreated, respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import { createTemplateSchema, listTemplatesQuerySchema, updateTemplateSchema } from './quotation-templates.schema.js';
import type { QuotationTemplatesService } from './quotation-templates.service.js';

export interface QuotationTemplatesRouterDeps {
  authService: AuthService;
  quotationTemplatesService: QuotationTemplatesService;
}

export function createQuotationTemplatesRouter({ authService, quotationTemplatesService }: QuotationTemplatesRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listTemplatesQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await quotationTemplatesService.list(actorFromUser(req.user!), validated(res, 'query', listTemplatesQuerySchema));
      respondOk(res, 'Quotation templates fetched.', result.templates, result.meta);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN),
    validateBody(createTemplateSchema),
    asyncHandler(async (req, res) => {
      const template = await quotationTemplatesService.create(actorFromUser(req.user!), validated(res, 'body', createTemplateSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${template.id}`);
      respondCreated(res, 'Quotation template created.', template);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Quotation template fetched.', await quotationTemplatesService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    validateBody(updateTemplateSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const template = await quotationTemplatesService.update(actorFromUser(req.user!), id, validated(res, 'body', updateTemplateSchema), req.ip);
      respondOk(res, 'Quotation template updated.', template);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await quotationTemplatesService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Quotation template deleted.');
    }),
  );

  return router;
}
