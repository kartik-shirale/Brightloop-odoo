import type { AuditLogDto, JsonValue, ListMeta } from '@brightloop/shared';
import { forbidden } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { isAdmin, type Actor } from '../../core/utils/actor.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway, AuditRecordInput } from './audit.gateway.js';
import { toAuditLogDto } from './audit.dto.js';
import type { AuditRepository } from './audit.repository.js';
import type { ListAuditLogsParams } from './audit.schema.js';

const SENSITIVE_KEY = /pass(word)?|token|secret|otp|authorization|cookie|hash|api[-_]?key|private[-_]?key|credential/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

/** Converts to plain JSON and masks any value stored under a credential-like key. */
export function redactMetadata(value: unknown, depth = 0): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((item) => redactMetadata(item, depth + 1));
  if (typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactMetadata(item, depth + 1);
    }
    return out;
  }
  return null;
}

export class AuditService implements AuditGateway {
  constructor(private readonly repository: AuditRepository) {}

  /** Never throws. A failed write is logged and the caller's operation proceeds. */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.repository.insert({
        userId: input.actor?.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata === undefined ? null : redactMetadata(input.metadata),
        ip: input.ip ?? null,
      });
    } catch (error) {
      logger.error(
        { err: error, action: input.action, entityType: input.entityType, entityId: input.entityId ?? null },
        'audit write failed',
      );
    }
  }

  async list(actor: Actor, query: ListAuditLogsParams): Promise<{ logs: AuditLogDto[]; meta: ListMeta }> {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
    const [rows, total] = await Promise.all([this.repository.list(query), this.repository.count(query)]);
    const userIds = rows.flatMap((row) => (row.userId === null ? [] : [row.userId]));
    const names = await this.repository.findUserNames(userIds);
    return {
      logs: rows.map((row) => toAuditLogDto(row, row.userId === null ? null : (names.get(row.userId) ?? null))),
      meta: listMetaFor(total, query.page, query.limit),
    };
  }
}
