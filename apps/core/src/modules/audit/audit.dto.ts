import type { AuditLogDto } from '@brightloop/shared';
import type { AuditLogRow } from './audit.repository.js';

export function toAuditLogDto(row: AuditLogRow, userName: string | null): AuditLogDto {
  return {
    id: row.id,
    userId: row.userId,
    userName,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    ip: row.ip,
    createdAt: row.createdAt,
  };
}
