/**
 * Auth HTTP layer (plain Express router — decorators dropped for simplicity).
 * Handlers stay thin: validate, delegate to the service, shape the response.
 */

import { Router, type Request, type Response, type Router as RouterType } from 'express';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { respondOk, respondCreated } from '../../core/utils/response.js';
import { env } from '../../config/env.js';
import { REFRESH_COOKIE } from '../../config/constants.js';
import { AuthService, type RequestFingerprint } from './auth.service.js';
import {
  forgotPasswordSchema,
  loginSchema,
  listSessionsQuerySchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  verifyResetOtpSchema,
} from './auth.schema.js';
import { validateBody, validateParams, validateQuery, validated } from '../../core/middlewares/validate.js';
import { otpRateLimiter } from '../../core/middlewares/rate-limit.js';
import { authenticate } from '../../core/middlewares/auth-barriers.js';
import { z } from 'zod';

const sessionIdParams = z.object({ id: z.coerce.number().int().positive() });

export interface AuthRouterDeps {
  authService: AuthService;
  rateLimiter?: RequestHandler;
}

/** Strips the refresh token — it travels only in the httpOnly cookie. */
const toAuthPayload = ({ user, accessToken, accessTokenExpiresIn, refreshExpiresAt }: Awaited<ReturnType<AuthService['login']>>) => ({
  user,
  accessToken,
  accessTokenExpiresIn,
  refreshExpiresAt,
});

function fingerprint(req: Request): RequestFingerprint {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ip: req.ip ?? null,
  };
}

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE.name, refreshToken, {
    path: REFRESH_COOKIE.path,
    httpOnly: REFRESH_COOKIE.httpOnly,
    sameSite: REFRESH_COOKIE.sameSite,
    secure: env.NODE_ENV === 'production',
    maxAge: AuthService.cookieMaxAgeMs(),
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE.name, {
    path: REFRESH_COOKIE.path,
    httpOnly: REFRESH_COOKIE.httpOnly,
    sameSite: REFRESH_COOKIE.sameSite,
    secure: env.NODE_ENV === 'production',
  });
}

function readRefreshCookie(req: Request): string | undefined {
  const raw = req.cookies?.[REFRESH_COOKIE.name];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export function createAuthRouter({ authService, rateLimiter = otpRateLimiter }: AuthRouterDeps): RouterType {
  const router = Router();

  // POST /auth/register — creates the user and emails the verification OTP.
  router.post(
    '/register',
    rateLimiter,
    validateBody(registerSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await authService.register(validated(res, 'body', registerSchema));
      respondCreated(
        res,
        `Account created. A ${AuthService.otpLength()}-digit code was sent to ${result.email}.`,
        result,
      );
    }),
  );

  // POST /auth/verify-otp — consumes the OTP, verifies the email, signs in.
  router.post(
    '/verify-otp',
    rateLimiter,
    validateBody(verifyOtpSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await authService.verifyOtp(validated(res, 'body', verifyOtpSchema), fingerprint(req));
      setRefreshCookie(res, result.refreshToken);
      respondOk(res, 'Email verified. Welcome aboard!', toAuthPayload(result));
    }),
  );

  // POST /auth/resend-otp — new code after the 60s cooldown.
  router.post(
    '/resend-otp',
    rateLimiter,
    validateBody(resendOtpSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await authService.resendOtp(validated(res, 'body', resendOtpSchema));
      respondOk(
        res,
        `If the account needs verification, a new code was sent to ${validated(res, 'body', resendOtpSchema).email}.`,
        result,
      );
    }),
  );

  // POST /auth/login — password sign-in for verified accounts.
  router.post(
    '/login',
    rateLimiter,
    validateBody(loginSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await authService.login(validated(res, 'body', loginSchema), fingerprint(req));
      setRefreshCookie(res, result.refreshToken);
      respondOk(res, 'Signed in.', toAuthPayload(result));
    }),
  );

  // POST /auth/refresh — rotates the refresh token, mints a new access token.
  router.post(
    '/refresh',
    validateBody(refreshSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await authService.refresh(validated(res, 'body', refreshSchema), readRefreshCookie(req));
      setRefreshCookie(res, result.refreshToken);
      respondOk(res, 'Session refreshed.', toAuthPayload(result));
    }),
  );

  // POST /auth/logout — revokes the session bound to the refresh cookie.
  router.post(
    '/logout',
    validateBody(logoutSchema),
    asyncHandler(async (req: Request, res: Response) => {
      await authService.logout(readRefreshCookie(req), validated(res, 'body', logoutSchema));
      clearRefreshCookie(res);
      respondOk(res, 'Signed out.');
    }),
  );

  // POST /auth/forgot-password — emails a reset OTP (enumeration-safe).
  router.post(
    '/forgot-password',
    rateLimiter,
    validateBody(forgotPasswordSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await authService.forgotPassword(validated(res, 'body', forgotPasswordSchema));
      respondOk(
        res,
        `If the account exists, a reset code was sent to ${validated(res, 'body', resendOtpSchema).email}.`,
        result,
      );
    }),
  );

  router.post('/verify-reset-otp', rateLimiter, validateBody(verifyResetOtpSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      const result = await authService.verifyResetOtp(validated(res, 'body', verifyResetOtpSchema));
      respondOk(res, 'Code verified. Choose a new password.', result);
    }),
  );

  // POST /auth/reset-password — OTP + new password; revokes all sessions.
  router.post(
    '/reset-password',
    rateLimiter,
    validateBody(resetPasswordSchema),
    asyncHandler(async (req: Request, res: Response) => {
      await authService.resetPassword(validated(res, 'body', resetPasswordSchema));
      clearRefreshCookie(res);
      respondOk(res, 'Password updated. Sign in with your new password.');
    }),
  );

  // ---- authenticated session management ----

  router.get(
    '/sessions',
    authenticate(authService),
    validateQuery(listSessionsQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await authService.listSessions(req.user!, validated(res, 'query', listSessionsQuerySchema));
      respondOk(res, 'Sessions fetched.', result.sessions, result.meta);
    }),
  );

  router.post(
    '/logout-all',
    authenticate(authService),
    asyncHandler(async (req: Request, res: Response) => {
      await authService.logoutAll(req.user!);
      clearRefreshCookie(res);
      respondOk(res, 'Signed out everywhere.');
    }),
  );

  router.delete(
    '/sessions/:id',
    authenticate(authService),
    validateParams(sessionIdParams),
    asyncHandler(async (req: Request, res: Response) => {
      await authService.revokeSession(req.user!, validated(res, 'params', sessionIdParams).id);
      respondOk(res, 'Session revoked.');
    }),
  );

  return router;
}

export type { RequestHandler };
