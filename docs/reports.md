# Reports module (M14)

Base path `/api/v1/reports`. Read-only dashboards and lists for staff. Every route is GET. The reports repository reads across `Subscription`, `Plan`, `Invoice`, `Payment` and `Customer` and never writes. This is a read-only entry in the section 4 exception list of the backend plan.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/summary` | ADMIN, STAFF | `from`, `to`, `planId`, `customerId` |
| GET | `/revenue/timeseries` | ADMIN, STAFF | `from`, `to`, `interval` (`day`, `week`, `month`; default `month`), `planId` |
| GET | `/revenue/by-plan` | ADMIN, STAFF | `from`, `to` |
| GET | `/payments/summary` | ADMIN, STAFF | `from`, `to` |
| GET | `/invoices/overdue` | ADMIN, STAFF | Paginated list |
| GET | `/aging` | ADMIN, STAFF | `customerId` |
| GET | `/subscriptions/expiring` | ADMIN, STAFF | Paginated list. `withinDays` 1 to 365, default 30 |

CUSTOMER callers get 403 and anonymous callers get 401. The service checks the role again. Unknown query keys return 400.

## Date ranges

- `from` and `to` are ISO 8601 dates or instants. Both bounds are inclusive. A date-only `to` means the end of that day (23:59:59.999 UTC).
- A missing `from` defaults to the first day of the current month, and a missing `to` defaults to the end of the month's last day. The current month is read from business today in `APP_TIMEZONE`, so at 01:30 IST on 1 November the default is November.
- If `from` is after `to`, the response is 400 `VALIDATION_ERROR` on `from`.
- Stored dates are UTC midnight of the business date, so a range and its buckets follow the business calendar.

## Definitions

- **Invoiced** is the sum of `total` on CONFIRMED and PAID invoices whose `issueDate` falls in the range. DRAFT and CANCELLED invoices are excluded.
- **Revenue received** is the sum of `Payment.amount` where `paymentDate` falls in the range.
- **Outstanding** is the sum of `amountDue` on CONFIRMED invoices with `amountDue > 0`, as of now. It ignores the range.
- **Overdue** is outstanding where `dueDate` is before business today. `overdueCount` is the number of those invoices, and `daysOverdue` is the number of whole days from the due date to today.
- **MRR** sums each plan's `recurringAmount` over its ACTIVE, non-deleted subscriptions and normalises the plan total to one month with `monthlyEquivalent` in `core/utils/money.ts`: DAILY x30, WEEKLY x52/12, MONTHLY x1, YEARLY /12. Rounding happens once per plan, half up to whole paise. The summary MRR is therefore exactly the sum of the per-plan MRR in `/revenue/by-plan`. It is a current value and ignores the range.
- **ARR** is MRR x 12.
- **New subscriptions** are the ones whose `activatedAt` falls in the range. **Closed subscriptions** are the ones whose `closedAt` falls in the range.
- `activeSubscriptions` and `subscriptionsByStatus` are current counts of non-deleted subscriptions. Every status is present, with 0 where there are none.
- For a fully paid or part-paid set of invoices issued and paid inside the range, `revenueReceived + outstandingAmount = invoicedAmount` to the paisa.

## Endpoints

### `/summary`

Returns `ReportSummaryDto`. `planId` narrows subscriptions, invoices and payments to that plan's subscriptions. `customerId` narrows all three to that customer.

### `/revenue/timeseries`

Returns a `{ period, invoiced, received }` array, oldest first, with one entry for every bucket that touches the range. Empty buckets are 0. `period` is the bucket start as an ISO instant. Days are calendar days, weeks are ISO weeks starting on Monday (the same as Postgres `date_trunc('week')`), and months start on the 1st. The first and last buckets can be partial. A `day` interval allows at most 366 calendar days and anything longer returns 400 on `interval`. `week` and `month` have no limit.

### `/revenue/by-plan`

Returns one row per plan that has active subscriptions or payments in the range: `{ planId, planName, activeSubscriptions, mrr, received }`. `activeSubscriptions` and `mrr` are current values, and `received` covers the range and is attributed to the plan of the invoiced subscription. Rows are sorted by MRR descending, then by received descending, then by plan id.

### `/payments/summary`

Returns `{ byMethod: [{ method, count, amount }], total }` for payments in the range. All seven methods are always listed in enum order, with zeros where there were no payments.

### `/invoices/overdue`

Rows are CONFIRMED invoices with `amountDue > 0` and a `dueDate` before business today, as `OverdueInvoiceDto` with `daysOverdue`. The query follows the list contract (backend plan 3.2):

- `page` and `limit` (1 to 100, default 10).
- `search` matches the invoice number, customer name or customer email, case-insensitively. These are the customer snapshot on the invoice. `%` and `_` are matched literally.
- Filters: `customerId`, `subscriptionId`, `minDaysOverdue` (at least 1), `minAmount` (paise, compared with `amountDue`), and `dueFrom` / `dueTo` (inclusive).
- `sortBy` is `daysOverdue` (the default), `amountDue` or `dueDate`. `sortOrder` defaults to `desc`, so the oldest debt comes first. `id` breaks ties.

### `/aging`

Covers outstanding invoices (CONFIRMED, `amountDue > 0`), optionally for one `customerId`. Each invoice goes into the bucket for its days past due:

| Bucket | Days past due |
|---|---|
| `notDue` | 0 (due today or later) |
| `days1To30` | 1 to 30 |
| `days31To60` | 31 to 60 |
| `days61To90` | 61 to 90 |
| `over90` | more than 90 |

Each bucket is `{ count, amount }`, where `amount` is the sum of `amountDue`.

### `/subscriptions/expiring`

This is the renewals list. It returns ACTIVE, non-deleted subscriptions where either:

- `expiryDate` is between today and the end of day `today + withinDays`, inclusive, or
- `expiryDate` is already past and the plan does not have `autoClose`.

Expired subscriptions on an `autoClose` plan are left out because the lifecycle job closes them. Each row is an `ExpiringSubscriptionDto`, and `autoClose` comes from the plan. Filters are `planId` and `customerId`. `search` matches the subscription number or the customer name. `sortBy` accepts only `expiryDate`. `sortOrder` defaults to `asc`, so the soonest expiry comes first, and `id` breaks ties.

## Performance

- Each endpoint runs at most three set-based queries in parallel with `Promise.all`. Nothing runs once per row.
  - `/summary`: subscription groups, invoice totals, payments received.
  - Timeseries: invoiced buckets and received buckets.
  - By plan: subscription groups and received by plan.
  - Payments summary and aging: one query each.
  - The two lists: one page query and one count. The joined names come in through `include`.
- Grouping that the ORM cannot express (`FILTER`, `date_trunc` buckets, joins from Payment through Invoice to Subscription) uses the parameter-bound raw lane (`prisma.raw.sql`). User input is never concatenated into SQL. An absent id filter is bound as the sentinel `0`, which no row can have.
- Relevant existing indexes: `Invoice(status, issueDate)`, `Invoice(dueDate, status)`, `Invoice(customerId, status)`, `Payment(paymentDate)`, `Payment(method)`, `Subscription(status)`, `Subscription(expiryDate, status)`, `Subscription(customerId, status)`, `Subscription(planId)`. No schema change and no migration was made.
- The `(param = 0 OR column = param)` filters can stop the planner from using a selective index when `planId` or `customerId` is supplied. Check this first if a filtered report misses its target.

**Unverified:** `EXPLAIN ANALYZE` on the `seed:perf` data and the p95 targets (under 500 ms at 10k subscriptions and 30k invoices) have not been checked.

## Example

```
GET /api/v1/reports/summary?from=2026-10-01&to=2026-10-31
```

```json
{ "success": true, "message": "Summary report fetched.",
  "data": { "activeSubscriptions": 5,
            "subscriptionsByStatus": { "DRAFT": 1, "QUOTATION": 0, "CONFIRMED": 0, "ACTIVE": 5, "PAUSED": 1, "CLOSED": 2 },
            "newSubscriptions": 2, "closedSubscriptions": 1,
            "invoicedAmount": 178180, "revenueReceived": 127000, "outstandingAmount": 51180,
            "overdueAmount": 50000, "overdueCount": 1, "mrr": 257333, "arr": 3087996 } }
```

```
GET /api/v1/reports/invoices/overdue?sortBy=amountDue&limit=20
```

```json
{ "success": true, "message": "Overdue invoices fetched.",
  "data": [ { "id": 2, "number": "INV-2026-000002", "customerId": 3, "customerName": "Acme Ltd",
              "subscriptionId": 2, "subscriptionNumber": "SUB-2026-000002", "dueDate": "2026-10-20T00:00:00.000Z",
              "total": 59000, "amountPaid": 9000, "amountDue": 50000, "daysOverdue": 11 } ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1, "hasNext": false, "hasPrev": false } }
```

## Error codes

`VALIDATION_ERROR` (400): bad or unknown query keys, `from` after `to`, a day interval over 366 days, `limit` over 100, or a `sortBy` outside the whitelist. `AUTH_REQUIRED` (401). `FORBIDDEN` (403).

## Environment

`APP_TIMEZONE`, which sets business today and the default month.
