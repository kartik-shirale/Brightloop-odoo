# Invoices module (M10)

Base path `/api/v1/invoices`. Generates one invoice per billing period of an ACTIVE subscription, and runs the invoice workflow (confirm, cancel, send, print). Exposes `InvoicesGateway.generateForSubscription` for billing runs (M11). There is no DELETE: invoices are cancelled, never deleted. Uses the invoices atomic-write exception (backend plan section 4).

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List |
| GET | `/preview` | ADMIN, STAFF | `?subscriptionId=`. Computes the next invoice without writing anything |
| POST | `/generate` | ADMIN, STAFF | `subscriptionId`, `asOf?` (`YYYY-MM-DD`, not in the future, default today), `autoConfirm?`. 201 with `Location` |
| GET | `/:id` | ADMIN, STAFF | Lines, payments, discount usages |
| PATCH | `/:id` | ADMIN, STAFF | DRAFT only: `notes` (`null` clears), `dueDate` (not before the issue date) |
| POST | `/:id/confirm` | ADMIN, STAFF | DRAFT to CONFIRMED with `amountDue = total`. A zero total goes straight to PAID |
| POST | `/:id/cancel` | ADMIN, STAFF | `reason` (1 to 500 chars). DRAFT or CONFIRMED with no payments |
| POST | `/:id/send` | ADMIN, STAFF | Emails the summary. CONFIRMED or PAID only |
| GET | `/:id/print` | ADMIN, STAFF | `InvoicePrintDto` |

CUSTOMER and anonymous callers are refused on the routes (403 and 401). Roles are checked again in the service. `/preview` and `/generate` are registered before `/:id`.

## List query

`search` (number, customer name, customer email; case-insensitive), `status` (comma list of `DRAFT,CONFIRMED,PAID,CANCELLED`), `customerId`, `subscriptionId`, `billingRunId`, `issueFrom` / `issueTo`, `dueFrom` / `dueTo` (inclusive, a date-only `To` means end of that day), `overdue`, `outstanding` (`true` or `false`), `minTotal`, `maxTotal` (paise), `sortBy` (`number`, `issueDate`, `dueDate`, `total`, `amountDue`, `status`, `createdAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the sort tie-breaker. Unknown keys return 400.

- **Outstanding** = CONFIRMED and `amountDue > 0`.
- **Overdue** = outstanding and `dueDate` before today in `APP_TIMEZONE`. Derived, never stored.

Every row carries computed `isOverdue`, `daysOverdue` and `allowedActions`.

## Generation

One code path serves `POST /generate` and the billing run. Each call bills exactly one period.

1. The subscription must be ACTIVE, have lines, and have a `nextBillingDate` on or before `asOf` and not after `expiryDate`. Otherwise the result is SKIPPED `NOTHING_TO_BILL` (409 on the manual endpoint).
2. Period = `[nextBillingDate, next boundary)`, computed from the `startDate` anchor so month ends do not drift (31 Jan, 28 Feb, 31 Mar). `periodEnd` is exclusive.
3. Lines are copied from the subscription snapshot (`amount = quantity * unitPrice`). `DiscountsGateway.evaluate` supplies the discounts. Tax is computed on the discounted amount and rounded per line. Totals are the exact sums of the stored lines.
4. `issueDate = asOf`. `dueDate = issueDate + dueDays` of the subscription's payment term, else the default term, else 0 days. The customer's name, email, tax id and billing address are copied onto the invoice.
5. One transaction:
   - advances `nextBillingDate` and `lastBilledUntil`, conditional on the `nextBillingDate` that was read;
   - increments each discount's `usedCount` while it is under `usageLimit`, in ascending id;
   - allocates the `INV-<year>-<n>` number;
   - inserts the invoice, its lines and its `DiscountUsage` rows.

   If another request advanced the subscription first, or the unique (subscription, period) constraint fires, nothing is committed and the result is SKIPPED `ALREADY_BILLED`. If a discount hits its limit during the transaction, everything rolls back and generation is retried once without that discount.
6. `autoConfirm` gives CONFIRMED with `amountDue = total` (PAID when the total is 0). Otherwise DRAFT with `amountDue = 0`.

## Cancel

A conditional update on DRAFT or CONFIRMED with `amountPaid = 0`. In the same transaction the invoice's `DiscountUsage` rows are deleted and each discount's `usedCount` is decremented. `nextBillingDate` is not moved back, so a cancelled period is not billed again (plan decision 10). An invoice with payments returns 409; delete the payments first.

## Send

Uses the EmailJS template `EMAILJS_INVOICE_TEMPLATE_ID` with parameters `to_email`, `name`, `invoice_number`, `total`, `due_date`, `portal_url` (`APP_PUBLIC_URL/portal/invoices/:id`). `sentAt` is set only after the mailer succeeds. A failed or unconfigured delivery returns 503 `DELIVERY_FAILED`, changes nothing and can be retried.

## Print

`InvoicePrintDto`: company details from `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_TAX_ID`; number, dates and period; customer snapshot; lines; a tax summary grouped by tax and rate; payments received; `amountPaid` and `amountDue`. Staff notes and audit ids are left out. The frontend formats currency and prints.

## Customer actor (used by the portal module)

`InvoicesService.list`, `get` and `print` accept `Actor { role: 'CUSTOMER', customerId }`. The `customerId` and the visible statuses (CONFIRMED, PAID) go into the query itself, and a `customerId` filter is ignored. DRAFT, CANCELLED and other customers' invoices return 404. Every write throws 403 for a CUSTOMER actor. For a customer, `allowedActions` is only `PRINT`.

## Audit

`invoice.generate` (number, subscription, status, total, period, `autoConfirm`, `billingRunId`, discount ids; actor is null for system runs), `invoice.update` (changes and previous values), `invoice.confirm`, `invoice.cancel` (reason, previous status), `invoice.send`.

## Environment

`APP_TIMEZONE`, `DEFAULT_CURRENCY`, `APP_PUBLIC_URL`, `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_TAX_ID`, `EMAILJS_INVOICE_TEMPLATE_ID`.

## Example

```
POST /api/v1/invoices/generate
{ "subscriptionId": 4, "autoConfirm": true }
```

```json
{ "success": true, "message": "Invoice generated.",
  "data": { "id": 12, "number": "INV-2026-000012", "subscriptionId": 4, "subscriptionNumber": "SUB-2026-000004",
            "customerId": 3, "status": "CONFIRMED", "currency": "INR",
            "periodStart": "2026-10-01T00:00:00.000Z", "periodEnd": "2026-11-01T00:00:00.000Z",
            "issueDate": "2026-10-31T00:00:00.000Z", "dueDate": "2026-11-15T00:00:00.000Z",
            "customerName": "Acme Ltd", "customerEmail": "billing@acme.test",
            "subtotal": 100000, "discountTotal": 0, "taxTotal": 18000, "total": 118000,
            "amountPaid": 0, "amountDue": 118000, "isOverdue": false, "daysOverdue": 0,
            "allowedActions": ["CANCEL", "SEND", "RECORD_PAYMENT", "PRINT"],
            "lines": [ "..." ], "payments": [], "discountUsages": [] } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `INVALID_STATE_TRANSITION` (409), `NOTHING_TO_BILL` (409), `ALREADY_BILLED` (409), `DISCOUNT_NOT_APPLICABLE` (409, a discount limit race that persisted after the retry), `DELIVERY_FAILED` (503).
