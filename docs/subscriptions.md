# Subscriptions module (M9)

Base path `/api/v1/subscriptions`. Exposes `SubscriptionsGateway` (`getForBilling`, `listDueIds`, `closeBySystem`, `listAutoCloseIds`) for invoices, billing runs and jobs. The service also takes a `CUSTOMER` actor for the portal module (see "Customer actor").

## Endpoints and roles

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List (see query below) |
| POST | `/from-template` | A, S | 201. DRAFT with plan and lines copied from the template. Registered before `/:id` |
| POST | `/` | A, S | 201 with `Location`. DRAFT |
| GET | `/:id` | A, S | Lines, status history, attached discounts, last 5 invoices (`id, number, status, total, issueDate, dueDate`) |
| PATCH | `/:id` | A, S | DRAFT/QUOTATION: header and lines. From CONFIRMED on: `notes` and `paymentTermId` only |
| DELETE | `/:id` | A | Soft delete, DRAFT only |
| POST | `/:id/send-quotation` | A, S | DRAFT to QUOTATION |
| POST | `/:id/confirm` | A, S | QUOTATION to CONFIRMED |
| POST | `/:id/activate` | A, S | CONFIRMED to ACTIVE |
| POST | `/:id/pause` | A, S | ACTIVE to PAUSED (plan `pausable`) |
| POST | `/:id/resume` | A, S | PAUSED to ACTIVE |
| POST | `/:id/close` | A, S | Body `{ "reason": "..." }` (required on the route, 1 to 500 chars) |
| POST | `/:id/renew` | A, S | 201 with `Location`. Returns the new DRAFT. No body needed |

CUSTOMER and anonymous callers get 403 and 401. Roles are checked on the route and again in the service.

## State table

| From | To | Action | Preconditions (checked in this order) | Side effects |
|---|---|---|---|---|
| DRAFT | QUOTATION | send-quotation | At least 1 line (400 otherwise) | `quotationValidUntil` = today + template `validityDays` when `templateId` is set and the template still exists, else stays null (never expires) |
| QUOTATION | CONFIRMED | confirm | `quotationValidUntil` not before today (a date equal to today is valid), plan available on `startDate`, each line quantity at least plan `minQuantity` | `confirmedAt` |
| CONFIRMED | ACTIVE | activate | none | `activatedAt`, `nextBillingDate` = `startDate` |
| ACTIVE | PAUSED | pause | plan `pausable` | `pausedAt` |
| PAUSED | ACTIVE | resume | none | `nextBillingDate` = first period boundary on or after today (month-end anchored on `startDate`), never before `lastBilledUntil`; `pausedAt` cleared |
| DRAFT, QUOTATION, CONFIRMED | CLOSED | close | always allowed | `closedAt`, `closeReason`, `nextBillingDate` cleared |
| ACTIVE, PAUSED | CLOSED | close | plan `closable` | same |
| ACTIVE, CLOSED | new DRAFT | renew | plan `renewable`, not already renewed by an open subscription | see Renew |

The status check comes first: an illegal source status is 409 `INVALID_STATE_TRANSITION` even when a plan flag would also block. Every transition is one conditional write (`WHERE status = <expected> AND deletedAt IS NULL`) plus a `SubscriptionStatusHistory` row in one transaction. Zero rows updated (a concurrent request moved it first) is 409 `INVALID_STATE_TRANSITION` and nothing is written. Every transition writes an audit entry (`subscription.sendQuotation`, `.confirm`, `.activate`, `.pause`, `.resume`, `.close`, `.renew`, plus `.create`, `.update`, `.delete`).

## Lines, prices and totals

The client sends only `productId`, `variantId?`, `taxId?`, `description?`, `quantity`, `sortOrder?` (ignored: order follows the array index). A body with `unitPrice`, `taxRate` or any other key is 400 (strict schema). The server:

- takes `unitPrice` from `CatalogGateway.getPricedItem` (inactive or unknown product/variant: 400 on `lines.N.productId` or `lines.N.variantId`),
- takes the tax from `TaxesGateway.getByIds` (unknown or inactive: 400 on `lines.N.taxId`),
- stores snapshots: `unitPrice`, `taxId`, `taxRate` (the tax's `rate` as given: **basis points for PERCENTAGE, paise per unit for FIXED**), `taxAmount = taxOnLine(...)`, `amount = quantity x unitPrice`, `description` (the client text, else the product name at that time),
- checks quantity against plan `minQuantity` per line (400 on `lines.N.quantity`).

Totals are recomputed from the lines on every line change in the same transaction: `subtotal = sum(amount)`, `taxTotal = sum(taxAmount)`, `total = subtotal + taxTotal`, `recurringAmount = total` (the amount billed per period; the plan's own `price` is not used). Integer paise only; each stored value must fit in int4 (400 otherwise). Later product price or tax changes never touch stored lines. Replacing the lines (PATCH) reprices at current prices.

Create rules: customer must exist (400 on `customerId`), plan must exist and be available on `startDate` (409 `PLAN_NOT_AVAILABLE`), `expiryDate` after `startDate` (400), a plan with `autoClose` requires `expiryDate` (400), payment term defaults to the default term (an explicit term must exist and be active; explicit `null` means none), number from `SequenceGateway` (`SUB-2026-000001`), `createdById` = caller. Dates are normalized to UTC midnight. Lines may be empty on a DRAFT (send-quotation then refuses).

PATCH on DRAFT/QUOTATION accepts `planId`, `startDate`, `expiryDate`, `paymentTermId`, `notes`, `lines` (template link and customer are never changed). The plan, dates and lines are re-validated together, and changing only the plan re-checks the stored lines against the new minimum. After CONFIRMED, any of `planId`, `startDate`, `expiryDate`, `lines` is 409 `INVALID_STATE_TRANSITION`.

## Renew

New subscription with the same plan, customer, payment term, template link and lines, **repriced at current prices and tax rates** (an inactive product or tax is a 400; the plan must be available on the new start: 409). Start = old `expiryDate`, or today when the old expiry is past or null. Expiry = start + the same number of days as the old term (null when the old expiry is null). `renewedFromId` is set, notes are not copied. A subscription that already has an open (non-closed, non-deleted) renewal cannot be renewed again (409 `INVALID_STATE_TRANSITION`).

- Staff (`autoActivate` absent or false): DRAFT, one history row `null -> DRAFT` with reason `Renewed from <number>`.
- Portal (`autoActivate: true`, always on for CUSTOMER actors): created ACTIVE with `confirmedAt`/`activatedAt` = now, `nextBillingDate` = its `startDate`, **one** history row `null -> ACTIVE` with reason `Renewed`.

## List query

`GET /subscriptions`: `page`, `limit` (1 to 100), `search` (subscription number, customer name, company name, customer email; case-insensitive), `sortBy` (`number`, `startDate`, `expiryDate`, `nextBillingDate`, `total`, `status`, `createdAt`; default `createdAt`), `sortOrder` (`id` tie-breaker), `status` (comma list), `customerId`, `planId`, `templateId`, `startFrom/To`, `expiryFrom/To`, `nextBillingFrom/To`, `createdFrom/To` (a date-only `To` means end of that day), `dueForBilling` (`true`: ACTIVE and `nextBillingDate` on or before today; `false`: the opposite), `expiringWithinDays` (1 to 365: ACTIVE with expiry from today to today + N), `include=lines`. Unknown keys and limit above 100 are 400. Soft-deleted rows never appear. Customers, plans and lines of a page are batch-loaded (no per-row queries).

## Customer actor (portal module)

The portal calls the service with `{ userId, role: 'CUSTOMER', customerId }`. For such an actor: `list(actor, query)`, `get`, `pause`, `resume`, `close(actor, id, { reason? })` and `renew(actor, id, {}, options?)` work; `customerId` is forced from the actor (a `customerId` filter is ignored), DRAFT subscriptions are invisible, and another customer's or any invisible subscription is 404 (never 403). The scope is part of the repository query. `create`, `createFromTemplate`, `update`, `remove`, `sendQuotation`, `confirm`, `activate` throw 403. Plan flags apply as for staff. `allowedActions` for a customer is limited to `PAUSE`, `RESUME`, `CLOSE`, `RENEW`. The DTO is the full internal one (notes, createdById, history): the portal strips it.

## Example

```
POST /api/v1/subscriptions
{ "customerId": 12, "planId": 1, "startDate": "2026-11-01", "expiryDate": "2027-11-01",
  "lines": [{ "productId": 10, "taxId": 1, "quantity": 2 }] }
```

```json
{ "success": true, "message": "Subscription created.",
  "data": { "id": 1, "number": "SUB-2026-000001", "status": "DRAFT", "customerId": 12, "planId": 1, "paymentTermId": 1,
            "startDate": "2026-11-01T00:00:00.000Z", "expiryDate": "2027-11-01T00:00:00.000Z", "nextBillingDate": null,
            "subtotal": 20000, "taxTotal": 3600, "total": 23600, "recurringAmount": 23600,
            "allowedActions": ["EDIT", "SEND_QUOTATION", "CLOSE", "DELETE"],
            "lines": [{ "productId": 10, "quantity": 2, "unitPrice": 10000, "taxId": 1, "taxRate": 1800, "taxAmount": 3600, "amount": 20000 }],
            "statusHistory": [{ "fromStatus": null, "toStatus": "DRAFT", "reason": null }], "discounts": [], "invoices": [] } }
```

## Gateway

`getForBilling(id)` returns `BillingSubscription` (dates as `Date`, lines with `taxType` resolved through `TaxesGateway`) or null. `listDueIds(asOf, afterId, limit)` is a keyset page (ACTIVE, not deleted, `nextBillingDate <= asOf`, and `nextBillingDate <= expiryDate` when an expiry exists, ascending id). `closeBySystem(id, reason)` is a conditional ACTIVE/PAUSED to CLOSED with a history row (`changedById` null) and an audit entry (actor null); false when not applicable. `listAutoCloseIds(asOf)`: ACTIVE with expiry day before the `asOf` day and a plan with `autoClose`.

## Shared type change

`SubscriptionDto.discounts` is now `SubscriptionDiscountDto[]` (`id, name, code, type, value, scope`, what `DiscountsGateway.listAttachedForSubscription` returns) and `SubscriptionDto.invoices` is `SubscriptionInvoiceSummaryDto[]` (`id, number, status, total, issueDate, dueDate`). Both were richer list-item types the gateways cannot fill.

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `DUPLICATE` (409, number clash), `IN_USE` (409, a referenced row vanished), `INVALID_STATE_TRANSITION` (409), `ACTION_NOT_ALLOWED_BY_PLAN` (409), `PLAN_NOT_AVAILABLE` (409), `QUOTATION_EXPIRED` (409).

## Limits

- Renewal duplicates are guarded by a read (`hasOpenRenewal`), not a constraint: two simultaneous renewals of the same subscription can both pass.
- The number is allocated before the insert, so a failed insert leaves a gap in the sequence.
- This module reads the Customer, Plan, Product, ProductVariant, Tax, User, PaymentTerm and Invoice tables (display names, plan flags, last invoices) and writes only Subscription, SubscriptionLine and SubscriptionStatusHistory.
