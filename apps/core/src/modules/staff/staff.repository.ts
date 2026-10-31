import { Role } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import type { UserRow } from '../../core/types/db-rows.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { ListStaffParams, UpdateStaffInput } from './staff.schema.js';

export interface CreateStaffData {
  name: string;
  email: string;
  username: string | null;
  passwordHash: string;
}

type UserAccessor = ModelAccessor<Contract, 'User', 'public'>;

const visibleStaff = (user: UserAccessor) => and(user.role.eq(Role.STAFF), user.deletedAt.isNull());

function buildWhere(query: ListStaffParams) {
  return (user: UserAccessor) => {
    const conditions = [];
    conditions.push(visibleStaff(user));
    if (query.search !== undefined) {
      const pattern = `%${query.search}%`;
      conditions.push(or(user.name.ilike(pattern), user.email.ilike(pattern), user.username.ilike(pattern)));
    }
    if (query.isActive !== undefined) conditions.push(user.isActive.eq(query.isActive));
    return and(...conditions);
  };
}

export class StaffRepository {
  async list(query: ListStaffParams): Promise<UserRow[]> {
    const asc = query.sortOrder === 'asc';
    return prisma.orm.public.User
      .where(buildWhere(query))
      .orderBy([
        (user) => {
          switch (query.sortBy) {
            case 'name': return asc ? user.name.asc() : user.name.desc();
            case 'email': return asc ? user.email.asc() : user.email.desc();
            case 'lastLoginAt': return asc ? user.lastLoginAt.asc() : user.lastLoginAt.desc();
            default: return asc ? user.createdAt.asc() : user.createdAt.desc();
          }
        },
        (user) => (asc ? user.id.asc() : user.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
  }

  async count(query: ListStaffParams): Promise<number> {
    const result = await prisma.orm.public.User.where(buildWhere(query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Only a STAFF user that is not soft-deleted. ADMIN and CUSTOMER ids return null. */
  async findStaffById(id: number): Promise<UserRow | null> {
    return prisma.orm.public.User.where((user) => and(user.id.eq(id), visibleStaff(user))).first();
  }

  /** Includes soft-deleted users of any role: email and username stay unique forever. */
  async findByEmail(email: string): Promise<UserRow | null> {
    return prisma.orm.public.User.whereUnique({ email }).first();
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    return prisma.orm.public.User.whereUnique({ username }).first();
  }

  async create(data: CreateStaffData): Promise<UserRow> {
    return prisma.orm.public.User.create({
      name: data.name,
      email: data.email,
      username: data.username,
      passwordHash: data.passwordHash,
      role: Role.STAFF,
      isActive: true,
      emailVerifiedAt: new Date().toISOString(),
    });
  }

  async update(id: number, patch: UpdateStaffInput): Promise<UserRow | null> {
    const rows = await prisma.orm.public.User
      .where((user) => and(user.id.eq(id), visibleStaff(user)))
      .updateAll({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.username !== undefined ? { username: patch.username } : {}),
      });
    return rows[0] ?? null;
  }

  /** Activation needs no session work. */
  async activate(id: number): Promise<UserRow | null> {
    const rows = await prisma.orm.public.User
      .where((user) => and(user.id.eq(id), visibleStaff(user)))
      .updateAll({ isActive: true });
    return rows[0] ?? null;
  }

  /** isActive=false and the session revoke commit together, or neither does. */
  async deactivate(id: number): Promise<UserRow | null> {
    return prisma.transaction(async (tx) => {
      const rows = await tx.orm.public.User
        .where((user) => and(user.id.eq(id), visibleStaff(user)))
        .updateAll({ isActive: false });
      const row = rows[0] ?? null;
      if (row !== null) await revokeSessions(tx, id);
      return row;
    });
  }

  /** Soft delete and the session revoke commit together. */
  async softDelete(id: number): Promise<UserRow | null> {
    return prisma.transaction(async (tx) => {
      const rows = await tx.orm.public.User
        .where((user) => and(user.id.eq(id), visibleStaff(user)))
        .updateAll({ deletedAt: new Date().toISOString(), isActive: false });
      const row = rows[0] ?? null;
      if (row !== null) await revokeSessions(tx, id);
      return row;
    });
  }
}

type Tx = Parameters<Parameters<typeof prisma.transaction>[0]>[0];

async function revokeSessions(tx: Tx, userId: number): Promise<void> {
  await tx.orm.public.Session
    .where((session) => and(session.userId.eq(userId), session.revokedAt.isNull()))
    .updateAll({ revokedAt: new Date().toISOString() });
}
