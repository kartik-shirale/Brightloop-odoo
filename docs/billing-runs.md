# Billing runs module (M11)

Base path `/api/v1/billing-runs`. A billing run invoices every ACTIVE subscription that is due on a run date, in the background, and records one item per subscription. It calls `InvoicesGateway.generateForSubscription` (M10) for each period and `SubscriptionsGateway.listDueIds` (M9) to find due subscriptions. It writes only `BillingRun` and `BillingRunItem`; invoices are created by the invoices module.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List |
| POST | `/` | ADMIN, STAFF | `runDate?` (`YYYY-MM-DD`, default today, not in the future), `autoConfirm?`, `subscriptionIds?`. 201 with `Location` and status RUNNING |
| GET | `/:id` | ADMIN, STAFF | Counters and status. Poll it until the status is not RUNNING |
| GET | `/:id/items` | ADMIN, STAFF | List of items |
| POST | `/:id/retry-failed` | ADMIN, STAFF | Reprocesses the FAILED items. 200 with status RUNNING |

CUSTOMER and anonymous callers are refused on the routes (403 and 401). Roles are checked again in the service.

## List queries

**Runs:** `status` (comma list of `RUNNING,COMPLETED,PARTIAL,FAILED`), `runFrom` / `runTo` (inclusive, a date-only `To` means end of that day), `triggeredById`, `sortBy` (`runDate`, `startedAt`, `createdCount`, `status`, default `startedAt`), `sortOrder`, `page`, `limit` (1 to 100). Runs have no text fields, so `search` returns 400.

**Items:** `search` (subscription number and item message, case-insensitive), `status` (comma list of `CREATED,SKIPPED,FAILED`), `subscriptionId`, `sortBy` (`id`, `status`, default `id`), `sortOrder`, `page`, `limit`. An unknown run returns 404.

`id` is the sort tie-breaker. Unknown keys return 400.

## Processing

1. `POST /` checks, in one repository transaction serialized per date by a Postgres advisory lock, that no run for the date is RUNNING (409 `BILLING_RUN_IN_PROGRESS` otherwise), then inserts the run as RUNNING. Correctness does not depend on this check: the invoice unique constraint and the conditional `nextBillingDate` advance prevent double billing anyway.
2. The response returns at once. The work continues in the background inside the same process.
3. Without `subscriptionIds`, due subscriptions are read in keyset batches of `BILLING_BATCH_SIZE` through `listDueIds(runDate, afterId, limit)`. With `subscriptionIds`, only those are processed (duplicates ignored; ids that do not exist are logged and get no item).
4. Each subscription is billed through the invoices gateway, one period and one transaction per call, with `billingRunId` set and a null actor. The invoices list filters on `billingRunId`.
5. **Catch-up.** A subscription with several overdue periods is billed in a loop until the gateway answers SKIPPED or `BILLING_MAX_CATCHUP_PERIODS` invoices were created. The remaining periods are billed by the next run.
6. Counters are refreshed after every batch. At the end the run gets `finishedAt` and its final status.

### One item per subscription

`BillingRunItem` is unique on (run, subscription), so a catch-up loop is summarized in one item:

| Item status | When | `invoiceId` | `message` |
|---|---|---|---|
| CREATED | at least one invoice created | the last one created | `3 invoices created`, plus `; catch-up limit of 12 periods reached, run again to bill the rest` at the cap |
| SKIPPED | nothing created | null | the gateway's reason, for example `Next billing date is 2026-11-15, after 2026-10-31` |
| FAILED | an error occurred | the last invoice created before the error, or null | the error message for domain errors; a generic message for anything else (the details go to the server log). Prefixed with `2 invoices created, then failed:` when the loop had already created invoices, which are kept |

### Final status

| Status | When |
|---|---|
| COMPLETED | No FAILED item (including a run with nothing due) |
| PARTIAL | Some FAILED items, and at least one CREATED or SKIPPED |
| FAILED | Every item FAILED, the run crashed, or recovery marked it stuck |

Counters: `totalDue` is the number of items (a count of subscriptions, not money), `createdCount`, `skippedCount`, `failedCount` count items by status. They are recomputed from the stored items, so a retry updates them correctly.

## Retry failed

`POST /:id/retry-failed` puts the run back to RUNNING (under the same per-date lock) and bills the subscriptions of its FAILED items again on the run's original `runDate`. Items are updated in place and the counters recomputed. `startedAt` becomes the start of the retry and `finishedAt` is cleared. A run does not store its `autoConfirm` choice, so retried invoices are DRAFT.

409 `BILLING_RUN_IN_PROGRESS` while the run (or another run for the same date) is RUNNING. 409 `INVALID_STATE_TRANSITION` when the run has no FAILED items.

## Recovery

A run whose process died stays RUNNING. On server start, runs RUNNING for longer than `BILLING_STUCK_RUN_MINUTES` are marked FAILED with `finishedAt` set. Re-running a date is always safe.

## Scheduled jobs (`core/jobs/scheduler.ts`)

Started from `server.ts` after the app is built, stopped first in graceful shutdown. A 60 second timer (unref'd) drives the jobs. A tick never throws: errors are logged and the job is retried on the next tick. Ticks never overlap. Off with `BILLING_SCHEDULER_ENABLED=false`.

| Job | When | Action |
|---|---|---|
| Recovery | Once on start, before the first tick | `recoverStuckRuns()` |
| Billing | First tick with the UTC hour at or after `BILLING_RUN_HOUR_UTC`, once per business date (`APP_TIMEZONE`) | `runScheduled()`: the same processing as `POST /`, with `triggeredById` null and `autoConfirm` false. Skipped when an automatic run (`triggeredById` null) for the date exists. Deferred to the next tick while another run for the date is RUNNING |
| Lifecycle | Same tick, after the billing run finished | `closeBySystem(id, 'Plan ended')` for each id in `listAutoCloseIds(today)`. One failed close does not stop the others; the job is retried on the next tick until all succeed |

Billing runs before lifecycle so the last period of an ending plan is invoiced before the subscription is closed. Two instances firing together cannot double-bill: the per-date lock, the automatic-run check and the invoice and `BillingRunItem` unique constraints absorb it. "Once per date" is remembered in memory; after a restart the database check stops a second automatic run.

## Audit

`billing-run.create` (run date, `autoConfirm`, `subscriptionIds`; actor null and `trigger: "scheduler"` for automatic runs), `billing-run.retry-failed` (run date, previous status, the retried subscription ids), `billing-run.recover` (actor null). Each generated invoice also gets its own `invoice.generate` entry with the `billingRunId`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `BILLING_SCHEDULER_ENABLED` | `true` | `true` or `false` |
| `BILLING_RUN_HOUR_UTC` | `0` | 0 to 23 |
| `BILLING_BATCH_SIZE` | `100` | 1 to 1000 |
| `BILLING_MAX_CATCHUP_PERIODS` | `12` | 1 to 120 |
| `BILLING_STUCK_RUN_MINUTES` | `30` | at least 1 |

## Example

```
POST /api/v1/billing-runs
{ "runDate": "2026-10-31", "autoConfirm": false }
```

```json
{ "success": true, "message": "Billing run started.",
  "data": { "id": 4, "runDate": "2026-10-31T00:00:00.000Z", "status": "RUNNING",
            "triggeredById": 2, "triggeredByName": "Priya Staff",
            "totalDue": 0, "createdCount": 0, "skippedCount": 0, "failedCount": 0,
            "startedAt": "2026-10-31T10:00:00.000Z", "finishedAt": null } }
```

```
GET /api/v1/billing-runs/4/items?status=FAILED
```

```json
{ "success": true, "message": "Billing run items fetched.",
  "data": [ { "id": 31, "billingRunId": 4, "subscriptionId": 12, "subscriptionNumber": "SUB-2026-000012",
              "invoiceId": null, "invoiceNumber": null, "status": "FAILED",
              "message": "A discount reached its usage limit while the invoice was generated. Please retry",
              "createdAt": "2026-10-31T10:00:02.000Z" } ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1, "hasNext": false, "hasPrev": false } }
```

## Error codes

`VALIDATION_ERROR` (400, including `runDate` in the future), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `BILLING_RUN_IN_PROGRESS` (409), `INVALID_STATE_TRANSITION` (409, retry with no failed items).
