/**
 * Authentication & user-facing API contract shared by `@odoo/core` and `@odoo/web`.
 *
 * Types here define the JSON envelope shapes returned by `/api/v1` so the
 * frontend can be typed against the backend without importing server code.
 */

export { Role } from './enums.js';
import type { Role } from './enums.js';
export type RoleDto = Role;

/** Public, safe-for-frontend projection of a user row. */
export interface UserDto {
  id: number;
  name: string;
  username: string | null;
  email: string;
  role: RoleDto;
  isActive: boolean;
  emailVerifiedAt: string | null;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A logged-in device/session owned by the current user. */
export interface SessionDto {
  id: number;
  userAgent: string | null;
  ip: string | null;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  /** `true` for the session matching the JWT currently in use. */
  current?: boolean;
}

/** Issued token pair (refresh token travels only in an httpOnly cookie). */
export interface AuthTokens {
  accessToken: string;
  /** ISO 8601 string for the expiry of the refresh token carried by the cookie. */
  refreshExpiresAt: string;
  accessTokenExpiresIn: number;
}

/** Response payload of /auth/verify-otp, /auth/login and /auth/refresh. */
export interface AuthResult extends AuthTokens {
  user: UserDto;
}

/** POST /auth/register body. Admin is seeded and cannot sign up. */
export interface RegisterDto {
  username?: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

/** POST /auth/login body. */
export interface LoginDto {
  email: string;
  password: string;
}

/** POST /auth/verify-otp and POST /auth/resend-otp body. */
export interface VerifyOtpDto {
  email: string;
  otp: string;
}

/** POST /auth/resend-otp body. */
export interface ResendOtpDto {
  email: string;
}

/** POST /auth/forgot-password body. */
export interface ForgotPasswordDto {
  email: string;
}

/** POST /auth/reset-password body. */
export interface VerifyResetOtpResultDto { resetToken: string; expiresInSeconds: number }

export interface ResetPasswordDto {
  email: string;
  otp?: string;
  resetToken?: string;
  password: string;
  confirmPassword: string;
}

/** API route paths (v1) for the auth + users modules. */
export const API_ROUTES = {
  auth: {
    register: '/api/v1/auth/register',
    verifyOtp: '/api/v1/auth/verify-otp',
    resendOtp: '/api/v1/auth/resend-otp',
    login: '/api/v1/auth/login',
    refresh: '/api/v1/auth/refresh',
    logout: '/api/v1/auth/logout',
    logoutAll: '/api/v1/auth/logout-all',
    sessions: '/api/v1/auth/sessions',
    session: (id: number | string) => `/api/v1/auth/sessions/${id}`,
    forgotPassword: '/api/v1/auth/forgot-password',
    resetPassword: '/api/v1/auth/reset-password',
    verifyResetOtp: '/api/v1/auth/verify-reset-otp',
  },
  users: {
    list: '/api/v1/users',
    me: '/api/v1/users/me',
    stats: '/api/v1/users/stats',
    changePassword: '/api/v1/users/me/password',
    detail: (id: number | string) => `/api/v1/users/${id}`,
  },
} as const;

/** Result of signup before email verification. */
export interface RegisterResultDto { email: string; expiresInSeconds: number }
export interface OtpResultDto { expiresInSeconds: number }
/** Optional JSON fallback; browsers normally use the httpOnly cookie. */
export interface RefreshDto { refreshToken?: string }
export type LogoutDto = RefreshDto;
export interface ListSessionsQueryDto { page?: number; limit?: number }
export interface UpdateMeDto { name?: string; username?: string | null }
export interface ChangePasswordDto {
  currentPassword: string;
  password: string;
  confirmPassword: string;
}
export interface ListUsersQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: 'createdAt' | 'name' | 'email' | 'lastLoginAt';
  order?: 'asc' | 'desc';
  role?: RoleDto;
  verified?: boolean;
  createdFrom?: string;
  createdTo?: string;
}
export interface UserStatsDto { total: number; verified: number; unverified: number; admins: number }
