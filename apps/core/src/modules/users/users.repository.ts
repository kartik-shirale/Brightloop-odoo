import { notFound } from '../../core/errors.js';
/**
 * Users module data access. The only layer that touches the `User` table
 * besides auth (backend-rules.md #1, #6).
 */

import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import type { UserRow } from '../../core/types/db-rows.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { ListUsersQuery, UpdateMeInput } from './users.schema.js';

export class UsersRepository {
  /** Paged, searched, sorted user list (backend-rules.md #2). */
  async listUsers(query: ListUsersQuery): Promise<UserRow[]> {
    return prisma.orm.public.User
      .where(buildWhere(query))
      .orderBy((user) =>
        query.sortBy === 'name'
          ? query.order === 'asc'
            ? user.name.asc()
            : user.name.desc()
          : query.sortBy === 'email'
            ? query.order === 'asc'
              ? user.email.asc()
              : user.email.desc()
            : query.sortBy === 'lastLoginAt'
              ? query.order === 'asc'
                ? user.lastLoginAt.asc()
                : user.lastLoginAt.desc()
              : query.order === 'asc'
                ? user.createdAt.asc()
                : user.createdAt.desc(),
      )
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
  }

  async countUsers(query: ListUsersQuery): Promise<number> {
    const result = await prisma.orm.public.User.where(buildWhere(query)).aggregate((agg) => ({
      total: agg.count(),
    }));
    return result.total;
  }

  async findUserById(id: number): Promise<UserRow | null> {
    return prisma.orm.public.User.whereUnique({ id }).first();
  }

  async updateUser(id: number, patch: UpdateMeInput): Promise<UserRow> {
    const row = await prisma.orm.public.User.whereUnique({ id }).update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.username !== undefined ? { username: patch.username ?? null } : {}),
    });
    if (!row) throw notFound('User not found');
    return row;
  }

  async findUserByUsername(username: string): Promise<UserRow | null> {
    return prisma.orm.public.User.where((user) => user.username.eq(username)).first();
  }

  /** Aggregate stats for the admin dashboard (rule #6: single aggregate call). */
  async stats(): Promise<{ total: number; verified: number; unverified: number; admins: number }> {
    const [total, verified, admins] = await Promise.all([
      prisma.orm.public.User.where((user) => user.deletedAt.isNull()).aggregate((agg) => ({ total: agg.count() })),
      prisma.orm.public.User
        .where((user) => and(user.deletedAt.isNull(), user.emailVerifiedAt.isNotNull()))
        .aggregate((agg) => ({ verified: agg.count() })),
      prisma.orm.public.User
        .where((user) => and(user.deletedAt.isNull(), user.role.eq('ADMIN')))
        .aggregate((agg) => ({ admins: agg.count() })),
    ]);
    return {
      total: total.total,
      verified: verified.verified,
      unverified: total.total - verified.verified,
      admins: admins.admins,
    };
  }
}

type UserAccessor = ModelAccessor<import('../../prisma/contract.d.js').Contract, 'User', 'public'>;

/** Composes the list filter from whitelisted query params (rule #2). */
function buildWhere(query: ListUsersQuery) {
  return (user: UserAccessor) => {
    const deleted = user.deletedAt.isNull();
    const base = [deleted];
    if (query.search !== undefined && query.search.length > 0) {
      const pattern = `%${query.search}%`;
      base.push(or(user.name.ilike(pattern), user.email.ilike(pattern)));
    }
    if (query.role !== undefined) {
      base.push(user.role.eq(query.role));
    }
    if (query.verified !== undefined) {
      base.push(
        query.verified ? user.emailVerifiedAt.isNotNull() : user.emailVerifiedAt.isNull(),
      );
    }
    if (query.createdFrom !== undefined) {
      base.push(user.createdAt.gte(query.createdFrom));
    }
    if (query.createdTo !== undefined) {
      base.push(user.createdAt.lte(query.createdTo));
    }
    return and(...base);
  };
}
