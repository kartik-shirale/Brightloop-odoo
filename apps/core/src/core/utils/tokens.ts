import { Role as Roles } from '@brightloop/shared';
/**
 * JWT + opaque-token helpers (backend-rules.md #6).
 *
 * - Access token: short-lived JWT carrying `sub`, `role`, and the `sid` of the
 *   session that minted it.
 * - Refresh token: opaque random hex, sent ONLY to `/auth/refresh`; we persist
 *   its SHA-256 on the session row (never the token itself).
 */

import { randomBytes } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { RoleDto as Role } from '@brightloop/shared';
import { env } from '../../config/env.js';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  role: Role;
  /** Session id that minted this token — lets revoked sessions be detected on refresh. */
  sid: number;
}

export const signAccessToken = (payload: { sub: number; role: Role; sid: number }): string =>
  jwt.sign(
    { sub: String(payload.sub), role: payload.role, sid: payload.sid },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'], algorithm: 'HS256' },
  );

/** Returns null instead of throwing so middleware can answer uniformly. */
export const verifyAccessToken = (token: string): AccessTokenPayload | null => {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !/^\d+$/.test(decoded.sub ?? '') ||
        !Number.isSafeInteger(Number(decoded.sub)) || Number(decoded.sub) <= 0 ||
        !Number.isSafeInteger(decoded.sid) || decoded.sid <= 0 ||
        !Object.values(Roles).includes(decoded.role) ||
        typeof decoded.iat !== 'number' || typeof decoded.exp !== 'number') {
      return null;
    }
    return decoded as AccessTokenPayload;
  } catch {
    return null;
  }
};

/** Opaque refresh token: 48 random bytes, safe to embed in an httpOnly cookie. */
export const generateRefreshToken = (): string => randomBytes(48).toString('hex');
