/**
 * Audit data access. The only layer that touches `AuditLog`. User names are
 * resolved with one batched query per page, never one per row.
 */

import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import type { JsonValue } from '@brightloop/shared';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { ListAuditLogsParams } from './audit.schema.js';

export interface AuditLogRow {
  id: number;
  userId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  metadata: JsonValue | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogInsert {
  userId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  metadata: JsonValue | null;
  ip: string | null;
}

/** The client types JSON columns as readonly; the stored value is plain JSON. */
function toRow(row: Omit<AuditLogRow, 'metadata'> & { metadata: unknown }): AuditLogRow {
  return { ...row, metadata: (row.metadata ?? null) as JsonValue | null };
}

type AuditAccessor = ModelAccessor<Contract, 'AuditLog', 'public'>;

function buildWhere(query: ListAuditLogsParams) {
  return (log: AuditAccessor) => {
    const conditions = [];
    if (query.search !== undefined) conditions.push(log.action.ilike(`%${query.search}%`));
    if (query.userId !== undefined) conditions.push(log.userId.eq(query.userId));
    if (query.action !== undefined) conditions.push(log.action.eq(query.action));
    if (query.entityType !== undefined) conditions.push(log.entityType.eq(query.entityType));
    if (query.entityId !== undefined) conditions.push(log.entityId.eq(query.entityId));
    if (query.createdFrom !== undefined) conditions.push(log.createdAt.gte(query.createdFrom.toISOString()));
    if (query.createdTo !== undefined) conditions.push(log.createdAt.lte(query.createdTo.toISOString()));
    return and(...conditions);
  };
}

export class AuditRepository {
  async insert(entry: AuditLogInsert): Promise<void> {
    await prisma.orm.public.AuditLog.create(entry);
  }

  async list(query: ListAuditLogsParams): Promise<AuditLogRow[]> {
    const rows = await prisma.orm.public.AuditLog
      .where(buildWhere(query))
      .orderBy([
        (log) => (query.sortOrder === 'asc' ? log.createdAt.asc() : log.createdAt.desc()),
        (log) => (query.sortOrder === 'asc' ? log.id.asc() : log.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toRow);
  }

  async count(query: ListAuditLogsParams): Promise<number> {
    const result = await prisma.orm.public.AuditLog
      .where(buildWhere(query))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Display names for the given user ids, in a single query. */
  async findUserNames(ids: readonly number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await prisma.orm.public.User
      .where((user) => or(...unique.map((id) => user.id.eq(id))))
      .all();
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
