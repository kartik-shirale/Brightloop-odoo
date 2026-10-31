# Sequences module

Allocates document numbers: `SUB-2026-000123` for subscriptions and `INV-2026-000456` for invoices. It has no HTTP endpoints, so there are no routes, roles or request examples. Other modules reach it through `SequenceGateway`.

## Gateway

```ts
next(key: 'SUBSCRIPTION' | 'INVOICE'): Promise<string>
```

- Format: `<PREFIX>-<year>-<value padded to 6 digits>`. Values past 999999 keep growing without truncation.
- The year is the business year in `APP_TIMEZONE` (default `Asia/Kolkata`), not the UTC year.
- A new year restarts the series at 1.
- Callers: subscriptions (M9) via the gateway. Invoices (M10) allocate inside their own transaction using the same SQL helper, as allowed by section 4 of the build plan.

## How it stays safe under concurrency

One parameter-bound statement does everything, in `core/utils/sequence-sql.ts`:

```sql
INSERT INTO "NumberSequence" (key, prefix, year, lastValue, updatedAt) VALUES ($1, $2, $3, 1, now())
ON CONFLICT (key) DO UPDATE SET
  lastValue = CASE WHEN stored.year >= EXCLUDED.year THEN stored.lastValue + 1 ELSE 1 END,
  year = GREATEST(stored.year, EXCLUDED.year), updatedAt = now()
RETURNING lastValue, year
```

- Create-if-missing, increment and year rollover are one atomic statement. Concurrent callers queue on the row lock, so no two get the same number and there is no read-then-write gap.
- A caller whose clock is behind the stored year keeps counting in the stored year, so a series never moves backwards. The returned year is the one used in the number.
- Called inside a transaction, a rollback releases the number, so invoice numbers have no gaps.
- The installed Prisma 8 contract client (rc.22) has no verified atomic-increment update, so this uses its parameter-bound `raw.sql` lane. Plain values interpolated into the template are bound parameters.

## Tests

- `bun run test`: format, per-key counters, year rollover in `APP_TIMEZONE` (fake repository).
- `bun run test:db` (real database): 50 parallel calls give 50 unique consecutive numbers, year rollover and an older clock, and a rolled-back transaction releasing its number. The test saves the `SUBSCRIPTION` counter row and restores it afterwards.

## Error codes

None. A database failure surfaces as a 500 through the global handler.
