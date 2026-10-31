# Customer portal module (M13)

Base paths `/api/v1/portal` and `/api/v1/me`. Self-service for CUSTOMER accounts: their own profile, subscriptions, invoices and payments. The module owns no table. Handlers are thin and call the owning services (subscriptions, invoices, payments, customers) with a CUSTOMER actor, then map the result through an explicit portal allowlist.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/me` | CUSTOMER | Profile from the customer record plus the login email |
| PATCH | `/me` | CUSTOMER | `name`, `companyName`, `phone`, `taxId`, `addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, `country`. At least one field. `email` and `notes` are rejected with 400 |
| GET | `/portal/summary` | CUSTOMER | Active subscriptions, next billing date, outstanding amount, overdue count and amount |
| GET | `/portal/subscriptions` | CUSTOMER | List. Never includes DRAFT |
| GET | `/portal/subscriptions/:id` | CUSTOMER | Lines, payment term name, the 5 most recent visible invoices |
| POST | `/portal/subscriptions/:id/pause` | CUSTOMER | Plan `pausable` applies |
| POST | `/portal/subscriptions/:id/resume` | CUSTOMER | |
| POST | `/portal/subscriptions/:id/close` | CUSTOMER | Body `{ "reason"?: string }` (1 to 500 chars) or no body. Plan `closable` applies from ACTIVE or PAUSED |
| POST | `/portal/subscriptions/:id/renew` | CUSTOMER | No body or `{}`. Plan `renewable` applies. 201 with `Location`. The new subscription is created ACTIVE |
| GET | `/portal/invoices` | CUSTOMER | List. CONFIRMED and PAID only |
| GET | `/portal/invoices/:id` | CUSTOMER | Lines and payments |
| GET | `/portal/invoices/:id/print` | CUSTOMER | `PortalInvoicePrintDto` |
| GET | `/portal/payments` | CUSTOMER | List. Payments on the customer's CONFIRMED and PAID invoices |

Every route runs `authenticate` then `requireRoles(CUSTOMER)`. ADMIN and STAFF tokens get 403, anonymous callers get 401. The service checks the role again. Staff routers (`/subscriptions`, `/invoices`, `/payments`, `/customers`) refuse CUSTOMER tokens with 403. Password change stays in auth.

## Ownership

- The customer id always comes from `CustomersGateway.getOrCreateForUser(userId)`. The first portal request of a new signup creates (or links by email) its customer record. A `customerId` in the query or body is rejected as an unknown key (400).
- The owning services scope a CUSTOMER actor inside the query itself: own rows only, no DRAFT subscriptions, CONFIRMED or PAID invoices only, payments on visible invoices only.
- Another customer's id, a DRAFT subscription, and a DRAFT or CANCELLED invoice all return **404** `NOT_FOUND`, so existence does not leak. List filters pointing at another customer's ids (`subscriptionId`, `invoiceId`) return an empty page.
- The `status` filters do not accept DRAFT (subscriptions) or DRAFT and CANCELLED (invoices): 400.

## Workflow actions

Pause, resume, close and renew go through `SubscriptionsService`, so the state machine, the plan flags, the conditional writes, status history and audit entries are the same as for staff. A plan flag violation returns 409 `ACTION_NOT_ALLOWED_BY_PLAN`; an illegal transition returns 409 `INVALID_STATE_TRANSITION`.

Renew uses the auto-activate path (`renew(actor, id, {}, { autoActivate: true })`): the customer's request is the approval, so the new subscription starts ACTIVE with start date = old expiry (or today when already past), and nothing bills early. Staff renewals still create a DRAFT.

`allowedActions` on portal subscriptions lists only `PAUSE`, `RESUME`, `CLOSE`, `RENEW`, filtered by status and plan flags.

## List queries

Standard contract: `page` (default 1), `limit` (1 to 100, default 10), `sortOrder` (`asc` or `desc`, default `desc`), `id` tie-breaker, unknown keys 400.

| List | `search` | Filters | `sortBy` (default) |
|---|---|---|---|
| `/portal/subscriptions` | yes (see below) | `status` (comma list of `QUOTATION,CONFIRMED,ACTIVE,PAUSED,CLOSED`), `planId` | `startDate`, `expiryDate`, `nextBillingDate`, `status`, `createdAt` (`createdAt`) |
| `/portal/invoices` | yes (see below) | `status` (`CONFIRMED,PAID`), `overdue`, `outstanding`, `subscriptionId`, `issueFrom/To`, `dueFrom/To` | `issueDate`, `dueDate`, `total`, `amountDue` (`issueDate`) |
| `/portal/payments` | no | `invoiceId`, `method` (comma list), `paidFrom/To` | `paymentDate`, `amount` (`paymentDate`) |

`search` is passed to the owning service, which matches the number plus the customer's own name, company and email (subscriptions) or name and email snapshot (invoices). Inside a customer scope that only ever matches the customer's own rows. Payments have no `search`, because the staff payment search covers internal notes.

`createdAt` is not sortable on invoices and payments in the portal, so their defaults are `issueDate` and `paymentDate`.

## Summary

`GET /portal/summary` reads four aggregates in parallel through the read-only `PortalRepository` (the same documented read-only exception as the reports repository; it never writes, and every query carries the `customerId` condition):

- `activeSubscriptions`: ACTIVE, not deleted.
- `nextBillingDate`: earliest `nextBillingDate` over those, or null.
- `outstandingAmount`: sum of `amountDue` on CONFIRMED invoices.
- `overdueCount`, `overdueAmount`: outstanding invoices with `dueDate` before today in `APP_TIMEZONE`.

## DTOs (shared `portal.ts`)

Every mapper copies an explicit list of fields. Never returned: `notes`, `createdById`, `billingRunId`, `recordedById`, `recordedByName`, payment `note`, `customerId`, `paymentTermId`, `templateId`, `cancelReason`, status history, `sentAt`, discount usages, cost data.

- `PortalProfileDto`: id, name, companyName, email (login email), phone, taxId, address fields.
- `PortalSubscriptionListItemDto` / `PortalSubscriptionDto`: number, plan, status, dates, totals, `allowedActions`; detail adds `paymentTermName`, lines (product and tax names, quantity, prices, amounts), recent invoices.
- `PortalInvoiceListItemDto` / `PortalInvoiceDto`: number, subscription, status, dates, period, totals, `amountPaid`, `amountDue`, `isOverdue`, `daysOverdue`; detail adds the customer snapshot, `paymentTermName`, `confirmedAt`, `paidAt`, lines and payments.
- `PortalPaymentDto`: id, invoiceId, invoiceNumber, method, amount, paymentDate, reference.
- `PortalInvoicePrintDto`: `InvoicePrintDto` with `status` narrowed to CONFIRMED or PAID.

## Audit

`PATCH /me` writes `customer.profile.update` (changes, previous values, `source: portal`) through `CustomersService.updateOwnProfile`. Workflow actions write the usual `subscription.pause`, `subscription.resume`, `subscription.close` and `subscription.renew` (with `autoActivated: true`) entries, with the CUSTOMER actor. The first portal request of a new customer writes `customer.create` or `customer.link`.

## Environment

`APP_TIMEZONE` (business today for overdue), plus those of the invoices module for print (`COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_TAX_ID`, `DEFAULT_CURRENCY`). No new variables.

## Example

```
POST /api/v1/portal/subscriptions/4/renew
```

```json
{ "success": true, "message": "Subscription renewed.",
  "data": { "id": 9, "number": "SUB-2026-000009", "planId": 1, "planName": "Pro", "status": "ACTIVE",
            "startDate": "2027-01-01T00:00:00.000Z", "expiryDate": "2028-01-01T00:00:00.000Z",
            "quotationValidUntil": null, "nextBillingDate": "2027-01-01T00:00:00.000Z",
            "subtotal": 100000, "taxTotal": 18000, "total": 118000, "recurringAmount": 118000,
            "createdAt": "2026-10-31T10:00:00.000Z", "updatedAt": "2026-10-31T10:00:00.000Z",
            "allowedActions": ["PAUSE", "CLOSE"], "paymentTermName": "Net 30",
            "lines": [ "..." ], "invoices": [] } }
```

```
PATCH /api/v1/me
{ "companyName": "Acme Ltd", "city": "Pune" }
```

```json
{ "success": true, "message": "Profile updated.",
  "data": { "id": 3, "name": "Asha Rao", "companyName": "Acme Ltd", "email": "asha@acme.test", "phone": null,
            "taxId": null, "addressLine1": null, "addressLine2": null, "city": "Pune", "state": null,
            "postalCode": null, "country": null } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403, wrong role or a deleted customer record), `NOT_FOUND` (404, missing, not owned, or hidden by status), `INVALID_STATE_TRANSITION` (409), `ACTION_NOT_ALLOWED_BY_PLAN` (409), `PLAN_NOT_AVAILABLE` (409, renew when the plan no longer exists or is unavailable).

## Wiring

```ts
// module imports: portal
import { PortalRepository } from './modules/portal/portal.repository.js';
import { PortalService } from './modules/portal/portal.service.js';
// module services: portal
readonly portalService: PortalService;
// module wiring: portal
const portalService = new PortalService(
  customersService, subscriptionsService, invoicesService, paymentsService, new PortalRepository(),
);
```

`app.ts` mounts `createPortalRouter` at `/portal` and `createPortalProfileRouter` at `/me`, never at `/`.
