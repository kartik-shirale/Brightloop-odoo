import { getKvStore, type KvStore } from '../../config/redis.js';
/**
 * Auth business logic (backend-rules.md #10). Owns:
 *  - registration + OTP verification (auto sign-in on success)
 *  - login / refresh (rotating refresh tokens in DB sessions)
 *  - logout, logout-all, per-device session management
 *  - forgot/reset password with email OTP
 *
 * Cross-cutting rules enforced here: no user enumeration on public endpoints,
 * password reset revokes every session, deleted accounts are dead ends.
 */

import { listMetaFor } from '../../core/utils/pagination.js';
import type { ListMeta } from '@brightloop/shared';
import { env } from '../../config/env.js';
import { REFRESH_COOKIE, OTP_DIGITS } from '../../config/constants.js';
import {
  badRequest,
  conflict,
  emailNotVerified,
  unauthorized,
} from '../../core/errors.js';
import { generateRefreshToken, signAccessToken, verifyAccessToken } from '../../core/utils/tokens.js';
import { hashPassword, verifyPassword, sha256 } from '../../core/utils/hash.js';
import type { AuthenticatedUser } from '../../core/types/express.js';
import type { AuthResultWithRefresh } from './auth.dto.js';
import { toUserDto } from './auth.dto.js';
import type { RoleDto, SessionDto } from '@brightloop/shared';
import type { AuthRepository } from './auth.repository.js';
import type { OtpService } from './otp.service.js';
import type {
  ForgotPasswordInput,
  LoginInput,
  ListSessionsQuery,
  RefreshInput,
  RegisterInput,
  ResendOtpInput,
  ResetPasswordInput,
  VerifyOtpInput,
  VerifyResetOtpInput,
} from './auth.schema.js';

export interface RequestFingerprint {
  userAgent: string | null;
  ip: string | null;
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly otps: OtpService,
    private readonly kv: KvStore = getKvStore(),
  ) {}

  /** Every protected request checks the current user and the issuing session. */
  async authenticate(token: string): Promise<AuthenticatedUser> {
    const payload = verifyAccessToken(token);
    if (!payload) throw unauthorized('AUTH_REQUIRED', 'Invalid or expired access token');
    const [user, session] = await Promise.all([
      this.repository.findUserById(Number(payload.sub)),
      this.repository.findSessionById(payload.sid),
    ]);
    if (!user || user.deletedAt !== null || !user.isActive || user.emailVerifiedAt === null) {
      throw unauthorized('AUTH_REQUIRED', 'Account is unavailable');
    }
    if (!session || session.userId !== user.id || session.revokedAt !== null ||
        Date.parse(session.expiresAt) <= Date.now()) {
      throw unauthorized('SESSION_REVOKED', 'Session expired or revoked. Sign in again.');
    }
    return { id: user.id, email: user.email, name: user.name, role: user.role, sid: session.id };
  }

  // ---- registration & email verification -----------------------------------

  /** Step 3–7: persist an unverified user, then email a hashed OTP. */
  async register(input: RegisterInput): Promise<{ email: string; expiresInSeconds: number }> {
    const existing = await this.repository.findUserByEmail(input.email);
    if (existing) {
      if (existing.deletedAt !== null || !existing.isActive || existing.emailVerifiedAt !== null) {
        throw conflict('EMAIL_IN_USE', 'An account with this email already exists. Sign in instead.');
      }
      // Retry a failed delivery without replacing the pending account's credentials.
      if (!await verifyPassword(input.password, existing.passwordHash)) {
        throw conflict('EMAIL_IN_USE', 'This account is waiting for verification. Sign in with the original password to resend the code.');
      }
      const issued = await this.otps.issue('verify', existing.email, existing.name);
      return { email: existing.email, expiresInSeconds: issued.expiresInSeconds };
    }

    if (input.username && await this.repository.findUserByUsername(input.username)) {
      throw conflict('CONFLICT', 'Username is already in use');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await this.repository.createUser({
      name: input.name,
      username: input.username,
      email: input.email,
      passwordHash,
      emailVerified: false,
    });

    const issued = await this.otps.issue('verify', user.email, user.name);
    return { email: user.email, expiresInSeconds: issued.expiresInSeconds };
  }

  /** Step 9 + auto sign-in: consume the OTP, mark verified, open a session. */
  async verifyOtp(input: VerifyOtpInput, fingerprint: RequestFingerprint): Promise<AuthResultWithRefresh> {
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.deletedAt !== null || !user.isActive) {
      // Deliberately the same error as a wrong OTP — no account enumeration.
      throw badRequest('OTP is invalid or expired. Request a new code.');
    }

    await this.otps.verify('verify', input.email, input.otp);
    const verified = user.emailVerifiedAt
      ? user
      : await this.repository.markEmailVerified(user.id);

    return this.openSession(verified.id, verified.role, fingerprint);
  }

  /** Step 11: resend with cooldown; never leaks whether the account exists. */
  async resendOtp(input: ResendOtpInput): Promise<{ expiresInSeconds: number }> {
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.deletedAt !== null || !user.isActive) {
      // Silent no-op for unknown addresses (enumeration guard).
      return { expiresInSeconds: env.OTP_TTL_SECONDS };
    }
    if (user.emailVerifiedAt !== null) {
      throw badRequest('Email is already verified. Sign in instead.');
    }
    return this.otps.issue('verify', user.email, user.name);
  }

  // ---- sessions ------------------------------------------------------------

  async login(input: LoginInput, fingerprint: RequestFingerprint): Promise<AuthResultWithRefresh> {
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.deletedAt !== null || !user.isActive) {
      throw unauthorized('AUTH_REQUIRED', 'Invalid email or password');
    }
    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      throw unauthorized('AUTH_REQUIRED', 'Invalid email or password');
    }
    if (user.emailVerifiedAt === null) {
      throw emailNotVerified();
    }

    await this.repository.touchLastLogin(user.id);
    return this.openSession(user.id, user.role, fingerprint);
  }

  /**
   * Refresh-token rotation: the presented token must match the session's
   * CURRENT hash; a match consumes it and mints a fresh pair. Unknown or
   * revoked tokens are rejected, expired ones are revoked server-side too.
   */
  async refresh(input: RefreshInput, refreshToken: string | undefined): Promise<AuthResultWithRefresh> {
    const token = refreshToken ?? input.refreshToken;
    if (!token) {
      throw unauthorized('AUTH_REQUIRED', 'Missing refresh token');
    }

    const session = await this.repository.findSessionByTokenHash(sha256(token));
    if (!session) {
      throw unauthorized('AUTH_REQUIRED', 'Invalid refresh token');
    }
    if (session.revokedAt !== null) {
      throw unauthorized('SESSION_REVOKED', 'Session was revoked. Sign in again.');
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await this.repository.revokeSession(session.id);
      throw unauthorized('SESSION_REVOKED', 'Session expired. Sign in again.');
    }

    const user = await this.repository.findUserById(session.userId);
    if (!user || user.deletedAt !== null || !user.isActive || user.emailVerifiedAt === null) {
      await this.repository.revokeSession(session.id);
      throw unauthorized('AUTH_REQUIRED', 'Account no longer exists');
    }

    const nextToken = generateRefreshToken();
    const refreshExpiresAt = this.refreshExpiry();
    const rotated = await this.repository.rotateSession(
      session.id,
      sha256(token),
      sha256(nextToken),
      refreshExpiresAt,
    );

    if (!rotated) throw unauthorized('SESSION_REVOKED', 'Refresh token was already used or revoked');

    return {
      user: toUserDto(user),
      accessToken: signAccessToken({
        sub: user.id,
        role: user.role as AuthResultWithRefresh['user']['role'],
        sid: session.id,
      }),
      accessTokenExpiresIn: this.accessTtlSeconds(),
      refreshExpiresAt,
      refreshToken: nextToken,
    };
  }

  /** Revokes the session bound to the presented refresh token (idempotent). */
  async logout(refreshToken: string | undefined, input: { refreshToken?: string }): Promise<void> {
    const token = refreshToken ?? input.refreshToken;
    if (!token) {
      throw unauthorized('AUTH_REQUIRED', 'Missing refresh token');
    }
    const session = await this.repository.findSessionByTokenHash(sha256(token));
    if (session && session.revokedAt === null) {
      await this.repository.revokeSession(session.id);
    }
  }

  /** Nukes every live session of the caller (e.g. "sign out everywhere"). */
  async logoutAll(user: AuthenticatedUser): Promise<void> {
    await this.repository.revokeAllSessionsForUser(user.id);
  }

  async listSessions(user: AuthenticatedUser, query: ListSessionsQuery): Promise<{ sessions: SessionDto[]; meta: ListMeta }> {
    const [rows, total] = await Promise.all([
      this.repository.listSessionsForUser(user.id, query.page, query.limit),
      this.repository.countSessionsForUser(user.id),
    ]);
    return { meta: listMetaFor(total, query.page, query.limit), sessions: rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      ip: row.ip,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      current: row.id === user.sid,
    })) };
  }

  async revokeSession(user: AuthenticatedUser, sessionId: number): Promise<void> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session || session.userId !== user.id) {
      throw badRequest('Session not found');
    }
    if (session.revokedAt === null) {
      await this.repository.revokeSession(session.id);
    }
  }

  // ---- password recovery ---------------------------------------------------

  /** Always answers success — never discloses whether the email is registered. */
  async forgotPassword(input: ForgotPasswordInput): Promise<{ expiresInSeconds: number }> {
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.deletedAt !== null || !user.isActive || user.emailVerifiedAt === null) {
      return { expiresInSeconds: env.OTP_TTL_SECONDS };
    }
    return this.otps.issue('reset', user.email, user.name);
  }

  /** Exchange a reset OTP for a short-lived, single-use password-reset grant. */
  async verifyResetOtp(input: VerifyResetOtpInput): Promise<{ resetToken: string; expiresInSeconds: number }> {
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.deletedAt !== null || !user.isActive || user.emailVerifiedAt === null) {
      throw badRequest('OTP is invalid or expired. Request a new code.');
    }
    await this.otps.verify('reset', input.email, input.otp);
    const resetToken = generateRefreshToken();
    await this.kv.set(`app:auth:reset-grant:${sha256(resetToken)}`, String(user.id), env.OTP_TTL_SECONDS);
    return { resetToken, expiresInSeconds: env.OTP_TTL_SECONDS };
  }

  /** Verifies the reset OTP, rotates the password, revokes every session. */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.deletedAt !== null || !user.isActive || user.emailVerifiedAt === null) {
      // Same generic error as a bad OTP: nothing about the account leaks.
      throw badRequest('OTP is invalid or expired. Request a new code.');
    }

    if (input.resetToken) {
      const userId = await this.kv.take(`app:auth:reset-grant:${sha256(input.resetToken)}`);
      if (userId !== String(user.id)) throw badRequest('Reset link expired. Request a new code.');
    } else if (input.otp) {
      await this.otps.verify('reset', input.email, input.otp);
    } else {
      throw badRequest('A verified reset token is required');
    }
    const passwordHash = await hashPassword(input.password);
    await this.repository.changePassword(user.id, passwordHash);
  }

  // ---- helpers -------------------------------------------------------------

  /** Creates the DB session + token pair. Used by verify-otp and login. */
  private async openSession(
    userId: number,
    role: RoleDto,
    fingerprint: RequestFingerprint,
  ): Promise<AuthResultWithRefresh> {
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = this.refreshExpiry();
    const session = await this.repository.createSession({
      userId,
      currentTokenHash: sha256(refreshToken),
      userAgent: fingerprint.userAgent,
      ip: fingerprint.ip,
      expiresAt: refreshExpiresAt,
    });

    const user = await this.repository.findUserById(userId);
    if (!user || user.deletedAt !== null || !user.isActive) throw unauthorized('AUTH_REQUIRED', 'Account no longer exists');
    return {
      user: toUserDto(user),
      accessToken: signAccessToken({
        sub: userId,
        role: role as AuthResultWithRefresh['user']['role'],
        sid: session.id,
      }),
      accessTokenExpiresIn: this.accessTtlSeconds(),
      refreshExpiresAt,
      refreshToken,
    };
  }

  private refreshExpiry(): string {
    return new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  private accessTtlSeconds(): number {
    const match = /^(\d+)([smh])$/.exec(env.ACCESS_TOKEN_TTL);
    if (!match) {
      return 15 * 60;
    }
    const value = Number(match[1]);
    const unitMs = match[2] === 's' ? 1000 : match[2] === 'm' ? 60_000 : 3_600_000;
    return Math.round((value * unitMs) / 1000);
  }

  /** Cookie options live with the service so controller and tests agree. */
  static cookieMaxAgeMs(): number {
    return env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000;
  }

  static refreshCookieName(): string {
    return REFRESH_COOKIE.name;
  }

  /** Guards the OTP length constant so schema and generator stay in sync. */
  static otpLength(): number {
    return OTP_DIGITS;
  }

  /** Exposed for tests: decode without trust (middleware does the real check). */
  static decodeAccessToken(token: string) {
    return verifyAccessToken(token);
  }
}
