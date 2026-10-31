/**
 * Row → DTO mappers for the auth module. Password hashes and session token
 * hashes NEVER leave the service layer.
 */

import type { SessionDto, UserDto } from '@brightloop/shared';
import type { SessionRow, UserRow } from '../../core/types/db-rows.js';

export const toUserDto = (row: UserRow): UserDto => ({
  id: row.id,
  name: row.name,
  username: row.username,
  email: row.email,
  role: row.role,
  isActive: row.isActive,
  emailVerifiedAt: row.emailVerifiedAt,
  passwordChangedAt: row.passwordChangedAt,
  lastLoginAt: row.lastLoginAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toSessionDto = (row: SessionRow, currentSessionId?: number): SessionDto => ({
  id: row.id,
  userAgent: row.userAgent,
  ip: row.ip,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  lastUsedAt: row.lastUsedAt,
  createdAt: row.createdAt,
  ...(currentSessionId !== undefined ? { current: row.id === currentSessionId } : {}),
});

/** Issued token pair + user, the payload of verify-otp / login / refresh. */
export interface AuthResultDto {
  user: UserDto;
  accessToken: string;
  /** Seconds until the access token expires (client refresh hint). */
  accessTokenExpiresIn: number;
  /** ISO expiry of the refresh token carried by the httpOnly cookie. */
  refreshExpiresAt: string;
}

/**
 * What the service hands to the controller. `refreshToken` exists ONLY to be
 * placed in the httpOnly cookie — it must never appear in a JSON body.
 */
export interface AuthResultWithRefresh extends AuthResultDto {
  refreshToken: string;
}
