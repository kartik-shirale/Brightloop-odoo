import { notFound } from '../../core/errors.js';
/**
 * Auth module data access. ONLY this class talks to the `User`/`Session`
 * tables (backend-rules.md #10); services never see raw queries.
 */

import { and } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { Role, type RoleDto } from '@brightloop/shared';
import type { UserRow, SessionRow } from '../../core/types/db-rows.js';

export interface CreateUserData {
  name: string;
  username?: string;
  email: string;
  passwordHash: string;
  role?: RoleDto;
  emailVerified: boolean;
}

export interface CreateSessionData {
  userId: number;
  currentTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  /** ISO timestamptz string. */
  expiresAt: string;
}

export class AuthRepository {
  // ---- users ---------------------------------------------------------------

  async findUserByEmail(email: string): Promise<UserRow | null> {
    return prisma.orm.public.User.whereUnique({ email }).first();
  }

  async findUserByUsername(username: string): Promise<UserRow | null> {
    return prisma.orm.public.User.whereUnique({ username }).first();
  }

  async findUserById(id: number): Promise<UserRow | null> {
    return prisma.orm.public.User.whereUnique({ id }).first();
  }

  async createUser(data: CreateUserData): Promise<UserRow> {
    return prisma.orm.public.User.create({
      name: data.name,
      username: data.username ?? null,
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role ?? Role.CUSTOMER,
      ...(data.emailVerified ? { emailVerifiedAt: new Date().toISOString() } : {}),
    });
  }

  async markEmailVerified(userId: number): Promise<UserRow> {
    const row = await prisma.orm.public.User.whereUnique({ id: userId }).update({
      emailVerifiedAt: new Date().toISOString(),
    });
    if (!row) throw notFound('User not found');
    return row;
  }

  async updatePassword(userId: number, passwordHash: string): Promise<UserRow> {
    const changedAt = new Date().toISOString();
    const row = await prisma.orm.public.User.whereUnique({ id: userId }).update({
      passwordHash,
      passwordChangedAt: changedAt,
    });
    if (!row) throw notFound('User not found');
    return row;
  }

  async touchLastLogin(userId: number): Promise<void> {
    await prisma.orm.public.User.whereUnique({ id: userId }).update({
      lastLoginAt: new Date().toISOString(),
    });
  }

  // ---- sessions ------------------------------------------------------------

  async createSession(data: CreateSessionData): Promise<SessionRow> {
    return prisma.orm.public.Session.create({
      userId: data.userId,
      currentTokenHash: data.currentTokenHash,
      userAgent: data.userAgent,
      ip: data.ip,
      expiresAt: data.expiresAt,
    });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    return prisma.orm.public.Session.whereUnique({ currentTokenHash: tokenHash }).first();
  }

  async findSessionById(id: number): Promise<SessionRow | null> {
    return prisma.orm.public.Session.whereUnique({ id }).first();
  }

  /** Conditional write makes each refresh token usable by exactly one request. */
  async rotateSession(sessionId: number, previousHash: string, tokenHash: string, expiresAt: string): Promise<boolean> {
    const rows = await prisma.orm.public.Session
      .where((session) => and(session.id.eq(sessionId), session.currentTokenHash.eq(previousHash),
        session.revokedAt.isNull(), session.expiresAt.gt(new Date().toISOString())))
      .updateAll({ currentTokenHash: tokenHash, expiresAt, lastUsedAt: new Date().toISOString() });
    return rows.length === 1;
  }

  /** Password changes and revocation commit together, or neither does. */
  async changePassword(userId: number, passwordHash: string, keepSessionId?: number): Promise<void> {
    await prisma.transaction(async (tx) => {
      const user = await tx.orm.public.User.whereUnique({ id: userId }).update({
        passwordHash, passwordChangedAt: new Date().toISOString(),
      });
      if (!user) throw notFound('User not found');
      await tx.orm.public.Session.where((session) => and(
        session.userId.eq(userId), session.revokedAt.isNull(),
        ...(keepSessionId === undefined ? [] : [session.id.neq(keepSessionId)]),
      )).updateAll({ revokedAt: new Date().toISOString() });
    });
  }

  async checkHealth(): Promise<void> {
    await prisma.orm.public.User.limit(1).all();
  }

  async revokeSession(sessionId: number): Promise<void> {
    await prisma.orm.public.Session.whereUnique({ id: sessionId }).update({
      revokedAt: new Date().toISOString(),
    });
  }

  async revokeAllSessionsForUser(userId: number): Promise<void> {
    await prisma.orm.public.Session.where({ userId })
      .where((session) => session.revokedAt.isNull())
      .updateAll({ revokedAt: new Date().toISOString() });
  }

  /** Revokes every live session of the user except the one in use (rule #8). */
  async revokeOtherSessionsForUser(userId: number, keepSessionId: number): Promise<void> {
    const now = new Date().toISOString();
    await prisma.orm.public.Session
      .where((session) => and(session.userId.eq(userId), session.id.neq(keepSessionId)))
      .where((session) => session.revokedAt.isNull())
      .updateAll({ revokedAt: now });
  }

  async countSessionsForUser(userId: number): Promise<number> {
    const result = await prisma.orm.public.Session.where({ userId }).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  async listSessionsForUser(userId: number, page: number, limit: number): Promise<SessionRow[]> {
    const rows = await prisma.orm.public.Session.where({ userId }).orderBy((session) => session.createdAt.desc()).limit(limit).offset((page - 1) * limit).all();
    return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}
