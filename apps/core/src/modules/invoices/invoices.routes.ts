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
  cancelInvoiceSchema, generateInvoiceSchema, listInvoicesQuerySchema, previewInvoiceQuerySchema, updateInvoiceSchema,
} from './invoices.schema.js';
import type { InvoicesService } from './invoices.service.js';

export interface InvoicesRouterDeps {
  authService: AuthService;
  invoicesService: InvoicesService;
}

type SimpleAction = 'confirm' | 'send';

const ACTION_MESSAGES: Record<SimpleAction, string> = {
  confirm: 'Invoice confirmed.',
  send: 'Invoice sent.',
};

export function createInvoicesRouter({ authService, invoicesService }: InvoicesRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listInvoicesQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await invoicesService.list(actorFromUser(req.user!), validated(res, 'query', listInvoicesQuerySchema));
      respondOk(res, 'Invoices fetched.', result.invoices, result.meta);
    }),
  );

  // Static routes come before /:id.
  router.get(
    '/preview',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(previewInvoiceQuerySchema),
    asyncHandler(async (req, res) => {
      const { subscriptionId } = validated(res, 'query', previewInvoiceQuerySchema);
      respondOk(res, 'Invoice preview computed.', await invoicesService.preview(actorFromUser(req.user!), subscriptionId));
    }),
  );

  router.post(
    '/generate',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateBody(generateInvoiceSchema),
    asyncHandler(async (req, res) => {
      const invoice = await invoicesService.generate(actorFromUser(req.user!), validated(res, 'body', generateInvoiceSchema), req.ip);
      res.setHeader('Location', `${req.baseUrl}/${invoice.id}`);
      respondCreated(res, 'Invoice generated.', invoice);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Invoice fetched.', await invoicesService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateBody(updateInvoiceSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const invoice = await invoicesService.update(actorFromUser(req.user!), id, validated(res, 'body', updateInvoiceSchema), req.ip);
      respondOk(res, 'Invoice updated.', invoice);
    }),
  );

  router.get(
    '/:id/print',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Invoice print data fetched.', await invoicesService.print(actorFromUser(req.user!), id));
    }),
  );

  for (const action of ['confirm', 'send'] as const) {
    router.post(
      `/:id/${action}`,
      requireRoles(Role.ADMIN, Role.STAFF),
      validateParams(idParamsSchema),
      asyncHandler(async (req, res) => {
        const { id } = validated(res, 'params', idParamsSchema);
        respondOk(res, ACTION_MESSAGES[action], await invoicesService[action](actorFromUser(req.user!), id, req.ip));
      }),
    );
  }

  router.post(
    '/:id/cancel',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateBody(cancelInvoiceSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const invoice = await invoicesService.cancel(actorFromUser(req.user!), id, validated(res, 'body', cancelInvoiceSchema), req.ip);
      respondOk(res, 'Invoice cancelled.', invoice);
    }),
  );

  return router;
}
