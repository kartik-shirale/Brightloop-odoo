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
  closeSubscriptionSchema, createFromTemplateSchema, createSubscriptionSchema, listSubscriptionsQuerySchema,
  renewSubscriptionSchema, updateSubscriptionSchema,
} from './subscriptions.schema.js';
import type { SubscriptionsService } from './subscriptions.service.js';

export interface SubscriptionsRouterDeps {
  authService: AuthService;
  subscriptionsService: SubscriptionsService;
}

type SimpleAction = 'sendQuotation' | 'confirm' | 'activate' | 'pause' | 'resume';

export function createSubscriptionsRouter({ authService, subscriptionsService }: SubscriptionsRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));

  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listSubscriptionsQuerySchema),
    asyncHandler(async (req, res) => {
      const result = await subscriptionsService.list(actorFromUser(req.user!), validated(res, 'query', listSubscriptionsQuerySchema));
      respondOk(res, 'Subscriptions fetched.', result.subscriptions, result.meta);
    }),
  );

  // Static routes come before /:id.
  router.post(
    '/from-template',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateBody(createFromTemplateSchema),
    asyncHandler(async (req, res) => {
      const subscription = await subscriptionsService.createFromTemplate(
        actorFromUser(req.user!), validated(res, 'body', createFromTemplateSchema), req.ip,
      );
      res.setHeader('Location', `${req.baseUrl}/${subscription.id}`);
      respondCreated(res, 'Subscription created from template.', subscription);
    }),
  );

  router.post(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateBody(createSubscriptionSchema),
    asyncHandler(async (req, res) => {
      const subscription = await subscriptionsService.create(
        actorFromUser(req.user!), validated(res, 'body', createSubscriptionSchema), req.ip,
      );
      res.setHeader('Location', `${req.baseUrl}/${subscription.id}`);
      respondCreated(res, 'Subscription created.', subscription);
    }),
  );

  router.get(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      respondOk(res, 'Subscription fetched.', await subscriptionsService.get(actorFromUser(req.user!), id));
    }),
  );

  router.patch(
    '/:id',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateBody(updateSubscriptionSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const subscription = await subscriptionsService.update(
        actorFromUser(req.user!), id, validated(res, 'body', updateSubscriptionSchema), req.ip,
      );
      respondOk(res, 'Subscription updated.', subscription);
    }),
  );

  router.delete(
    '/:id',
    requireRoles(Role.ADMIN),
    validateParams(idParamsSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await subscriptionsService.remove(actorFromUser(req.user!), id, req.ip);
      respondOk(res, 'Subscription deleted.');
    }),
  );

  const simpleActions: { path: string; method: SimpleAction; message: string }[] = [
    { path: 'send-quotation', method: 'sendQuotation', message: 'Quotation sent.' },
    { path: 'confirm', method: 'confirm', message: 'Subscription confirmed.' },
    { path: 'activate', method: 'activate', message: 'Subscription activated.' },
    { path: 'pause', method: 'pause', message: 'Subscription paused.' },
    { path: 'resume', method: 'resume', message: 'Subscription resumed.' },
  ];
  for (const action of simpleActions) {
    router.post(
      `/:id/${action.path}`,
      requireRoles(Role.ADMIN, Role.STAFF),
      validateParams(idParamsSchema),
      asyncHandler(async (req, res) => {
        const { id } = validated(res, 'params', idParamsSchema);
        respondOk(res, action.message, await subscriptionsService[action.method](actorFromUser(req.user!), id, req.ip));
      }),
    );
  }

  router.post(
    '/:id/close',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateBody(closeSubscriptionSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const subscription = await subscriptionsService.close(
        actorFromUser(req.user!), id, validated(res, 'body', closeSubscriptionSchema), req.ip,
      );
      respondOk(res, 'Subscription closed.', subscription);
    }),
  );

  router.post(
    '/:id/renew',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateParams(idParamsSchema),
    validateBody(renewSubscriptionSchema),
    asyncHandler(async (req, res) => {
      const { id } = validated(res, 'params', idParamsSchema);
      const subscription = await subscriptionsService.renew(actorFromUser(req.user!), id, {}, { ip: req.ip });
      res.setHeader('Location', `${req.baseUrl}/${subscription.id}`);
      respondCreated(res, 'Subscription renewed.', subscription);
    }),
  );

  return router;
}
