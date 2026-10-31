import type { DateInput, IsoDateTime, JsonValue, ListQuery } from './common.js';
export interface AuditLogDto {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  /** Server redacts credentials/tokens before persisting metadata. */
  metadata: JsonValue;
  ip: string | null;
  createdAt: IsoDateTime;
}
export interface ListAuditLogsQuery extends ListQuery<'createdAt'> {
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: number;
  createdFrom?: DateInput;
  createdTo?: DateInput;
}
