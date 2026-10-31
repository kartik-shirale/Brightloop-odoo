/**
 * The one statement that allocates a document number. Shared by the sequences
 * repository and by the invoices repository, which calls it inside its own
 * transaction (backend plan section 4) so a rolled-back invoice releases its
 * number and numbers stay consecutive.
 *
 * A single INSERT ... ON CONFLICT DO UPDATE is atomic: concurrent callers queue
 * on the row lock. Year rollover resets to 1 in the same statement. A caller
 * whose clock is behind the stored year keeps counting in the stored year, so a
 * series never moves backwards.
 */

import { SequenceKey } from '@brightloop/shared';
import type { PostgresQueryMembers } from '@prisma/orm-postgres/runtime';
import type { Contract } from '../../prisma/contract.d.js';

/** Accepts the shared client or a transaction context. */
export type SequenceExecutor = Pick<PostgresQueryMembers<Contract>, 'raw' | 'sql' | 'query'>;

export const SEQUENCE_PREFIX: Record<SequenceKey, string> = {
  [SequenceKey.SUBSCRIPTION]: 'SUB',
  [SequenceKey.INVOICE]: 'INV',
};

export interface AllocatedSequence {
  value: number;
  year: number;
}

export async function allocateSequenceValue(
  executor: SequenceExecutor,
  key: SequenceKey,
  year: number,
): Promise<AllocatedSequence> {
  const table = executor.sql.public.NumberSequence;
  const plan = executor.raw.sql`
    INSERT INTO "public"."NumberSequence" ("key", "prefix", "year", "lastValue", "updatedAt")
    VALUES (${key}, ${SEQUENCE_PREFIX[key]}, ${year}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "lastValue" = CASE WHEN "NumberSequence"."year" >= EXCLUDED."year"
        THEN "NumberSequence"."lastValue" + 1 ELSE 1 END,
      "year" = GREATEST("NumberSequence"."year", EXCLUDED."year"),
      "updatedAt" = now()
    RETURNING "lastValue", "year"`
    .returnsRow({ lastValue: table.columns.lastValue, year: table.columns.year })
    .build();
  const rows = await executor.query(plan);
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) {
    throw new Error('Sequence allocation returned no row');
  }
  return { value: row.lastValue, year: row.year };
}

/** `SUB-2026-000123`: six digits minimum, growing past that without truncation. */
export function formatSequenceNumber(key: SequenceKey, year: number, value: number): string {
  return `${SEQUENCE_PREFIX[key]}-${year}-${String(value).padStart(6, '0')}`;
}
