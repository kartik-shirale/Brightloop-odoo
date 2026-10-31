import { z } from 'zod';
import { buildListQuerySchema, queryDate, queryPositiveInt } from '../../core/utils/list-query.js';

const textFilter = z.string().trim().min(1).max(100);

export const listAuditLogsQuerySchema = buildListQuerySchema({
  sortable: ['createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    userId: queryPositiveInt,
    action: textFilter,
    entityType: textFilter,
    entityId: queryPositiveInt,
    createdFrom: queryDate('from'),
    createdTo: queryDate('to'),
  },
});

export type ListAuditLogsParams = z.infer<typeof listAuditLogsQuerySchema>;
