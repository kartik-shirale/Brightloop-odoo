import type { RequestHandler } from 'express';
import type { RoleDto } from '@brightloop/shared';
import type { AuthService } from '../../modules/auth/auth.service.js';
import { forbidden, unauthorized } from '../errors.js';

export function authenticate(auth: Pick<AuthService, 'authenticate'>): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token) throw unauthorized('AUTH_REQUIRED', 'Missing bearer token');
      req.user = await auth.authenticate(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}
export const requireRoles = (...roles: readonly RoleDto[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(unauthorized('AUTH_REQUIRED', 'Authentication required'));
  if (roles.length && !roles.includes(req.user.role)) return next(forbidden('Insufficient permissions'));
  next();
};
