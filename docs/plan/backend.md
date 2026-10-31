# Brightloop Subscription Management: Backend Build Plan

Scope: backend only. Auth is finished. Follows the Backend Engineering Rules (Express 5, Prisma 8 contract client, Zod, feature modules, shared types). No new Redis code in these modules. Money is integer paise, rates are basis points. Legend: **A** = ADMIN, **S** = STAFF, **C** = CUSTOMER.

## 0. Decisions to confirm before coding

| # | Conflict or gap | Resolution used in this plan |
|---|---|---|
| 1 | The rules and the example router use `USER` and `MANAGER`. The new schema uses `CUSTOMER`, `STAFF`, `ADMIN`. | Task F1 renames roles in `@brightloop/shared`, auth signup default, seed and the existing users router. This is the only change to auth. |
| 2 | Schema was delivered as `schema.prisma`. The project uses `src/prisma/contract.prisma`. | Port it unchanged, then run `contract:emit`, `migration:plan`, inspect, `db:migrate`, `db:verify`. Existing rows need data mapping: USER to CUSTOMER, MANAGER to STAFF. |
| 3 | Rules require exact money storage. | Integer paise satisfies this. `Int` caps near ₹2.14 crore per field. Decide Int or BigInt before the first migration, because changing later means a data migration. |
| 4 | No Redis in these modules. | Idempotency and concurrency use DB unique constraints, conditional writes and the `BillingRun` tables. The existing rate-limit middleware stays on routes as it is today. |
| 5 | Rules forbid importing another module's repository, but invoice generation and payment recording must change several tables atomically. | The owning repository may write a fixed list of foreign tables (section 4). Everything else goes through gateways. |
| 6 | No queue and no Redis for scheduled jobs. | An in-process timer calls the same service as the manual endpoint. If two instances fire, the DB blocks duplicates. No new library. |
| 7 | Billing for hundreds of subscriptions cannot finish inside a 2 second request. | `POST /billing-runs` returns 201 with status RUNNING and the work continues in the background. The client polls `GET /billing-runs/:id`. |
| 8 | A signed-up customer has a `User` but no `Customer` row. | The customers service does get-or-create from the `User` on the first portal request. No auth change. If staff already created a customer with the same email, it links to it. |
| 9 | Staff sees products, but cost price is margin data. | Staff DTOs omit `costPrice`. Only A receives it. |
| 10 | A cancelled invoice still occupies the unique slot (subscription, periodStart, periodEnd). | A cancelled period is not re-billed automatically. Re-billing a cancelled period needs a schema change and is out of scope. |
| 11 | Plan `minQuantity` is ambiguous. | It applies to the quantity of each subscription line. |
| 12 | Rules list no PDF library. | `GET /invoices/:id/print` returns a JSON print DTO and the frontend prints it. The invoice email carries a summary and a portal link, not an attachment. |
| 13 | Admin creates staff but there is no `mustChangePassword` field. | Admin sets the initial password. Optional later change: add the field and force a change on first login. |

## 1. Application flow

1. **Setup (A).** Taxes, payment terms, products and variants, plans, discount rules, quotation templates, staff accounts.
2. **Sales (A, S).** Create or find the customer. Create a subscription from a template (Draft). Send the quotation, confirm it, activate it. Each step is a workflow action and is recorded in the status history.
3. **Billing day (system or A, S).** A billing run takes every ACTIVE subscription with `nextBillingDate` on or before the run date. For each due period it creates one Draft invoice with lines, discounts, taxes and totals already filled in, then advances `nextBillingDate`. Staff confirm and send the invoices.
4. **Collection (A, S).** Staff record a payment against a confirmed invoice. The balance falls. At zero the invoice becomes Paid. Overdue means CONFIRMED, `amountDue > 0` and `dueDate` passed. It is derived and never stored.
5. **Customer portal (C).** The customer sees only their own non-draft subscriptions, confirmed or paid invoices and payments. They can pause, resume, close or renew where the plan allows.
6. **Finance (A, S).** Reports: active subscriptions, revenue received, outstanding, overdue, aging, MRR.
7. **Automation.** Scheduler runs the billing run and the lifecycle job (auto-close subscriptions past expiry when the plan has `autoClose`).

### Subscription state machine

| From | To | Action endpoint | Preconditions | Side effects |
|---|---|---|---|---|
| DRAFT | QUOTATION | `POST /subscriptions/:id/send-quotation` | At least 1 line | Sets `quotationValidUntil` = today + template `validityDays` when a template was used |
| QUOTATION | CONFIRMED | `/confirm` | Quotation not expired. Plan available on `startDate`. Line quantity at least plan `minQuantity` | Sets `confirmedAt` |
| CONFIRMED | ACTIVE | `/activate` | None | Sets `activatedAt`, `nextBillingDate` = `startDate` |
| ACTIVE | PAUSED | `/pause` | Plan `pausable` | Sets `pausedAt`. Billing stops |
| PAUSED | ACTIVE | `/resume` | None | `nextBillingDate` = first period boundary on or after today, so paused time is not back-billed |
| any except CLOSED | CLOSED | `/close` | From ACTIVE or PAUSED the plan must be `closable`. Before activation it is always allowed. Body: `reason` | Sets `closedAt`, `closeReason`, clears `nextBillingDate` |
| ACTIVE or CLOSED | new DRAFT | `/renew` | Plan `renewable` | Creates a new subscription with `renewedFromId`, start = old expiry (or today if past), lines re-priced at current prices |

The lifecycle job closes ACTIVE subscriptions past `expiryDate` when the plan has `autoClose`. Without `autoClose` they stay ACTIVE, billing stops for periods starting after expiry, and they appear in the reports as needing attention.

Every transition writes a `SubscriptionStatusHistory` row and an audit log row. An illegal transition returns 409 `INVALID_STATE_TRANSITION`. A plan flag violation returns 409 `ACTION_NOT_ALLOWED_BY_PLAN`.

### Invoice state machine

| From | To | Endpoint | Roles | Rules |
|---|---|---|---|---|
| (generated) | DRAFT | billing run or `POST /invoices/generate` | A, S, system | Unique per subscription and period |
| DRAFT | CONFIRMED | `POST /invoices/:id/confirm` | A, S | Sets `confirmedAt`, `amountDue` = `total` |
| DRAFT or CONFIRMED | CANCELLED | `/cancel` | A, S | Reason required. Not allowed if any payment exists. Releases discount usage |
| CONFIRMED | PAID | automatic on payment | system | When `amountDue` reaches 0. Sets `paidAt` |
| PAID | CONFIRMED | automatic when an admin deletes a payment | system | Clears `paidAt` |

`send` and `print` are actions, not states. `send` sets `sentAt` and is allowed for CONFIRMED and PAID only.

## 2. Roles and access model

| Role | Scope |
|---|---|
| ADMIN | Everything, including configuration, staff, discounts, audit logs |
| STAFF | Customers, subscriptions, invoices, payments, billing runs, reports. Read-only on catalog, plans, taxes, discounts, templates. Cannot manage staff |
| CUSTOMER | Portal only. Own data only |

Enforcement has three layers, and all three are required:

1. **Route.** `requireRoles(...)` after `authenticate`. The `/portal` router allows C only. All other routers deny C.
2. **Service.** Every service method receives an `Actor` (`{ userId, role, customerId? }`). For a C actor the service forces `customerId` from the actor. A `customerId` in the query or body is ignored for C and rejected with 403 on staff-only fields.
3. **Repository.** Customer-scoped reads always include the `customerId` condition in the query itself.

Accessing another customer's record returns **404**, not 403, so existence does not leak. DRAFT invoices, DRAFT subscriptions and CANCELLED invoices are invisible to C.

## 3. API conventions (apply to every module)

### 3.1 URLs

- Base `/api/v1/<plural-kebab-resource>`. Workflow actions are `POST /<resource>/:id/<action>` and return 200 with the updated resource.
- IDs are positive integers validated with `validateParams`.
- Register static routes (`/from-template`, `/generate`, `/summary`) before `/:id`, or Express will treat them as ids.
- No nested list routes such as `/customers/:id/invoices`. Use the owning module's list with a filter: `GET /invoices?customerId=12`. This avoids two modules owning one list.
- Middleware order: `rateLimit -> authenticate -> requireRoles -> validateParams/Query/Body -> asyncHandler(handler)`.

### 3.2 List contract (every GET list)

| Param | Rule |
|---|---|
| `page` | Integer at least 1. Default 1 |
| `limit` | 1 to 100. Default 10 |
| `search` | Trimmed, 1 to 100 chars. Case-insensitive `ilike` OR across the fields listed for that endpoint |
| `sortBy` | Whitelist per endpoint. Default `createdAt` |
| `sortOrder` | `asc` or `desc`. Default `desc`. Always add `id` as tie-breaker so pages are stable |
| Enum filters | Comma list: `status=ACTIVE,PAUSED`. Each value checked against the enum |
| Boolean filters | `true` or `false` only |
| Date ranges | `<name>From` and `<name>To`, ISO 8601, inclusive. A date-only `To` means end of that day |
| Money filters | `minTotal`, `maxTotal` in paise |
| `include` | Whitelist per endpoint, for example `include=variants` |
| Unknown keys | 400 `VALIDATION_ERROR` (Zod `.strict()`) |

Soft-deleted rows are excluded in every list. List and count run in `Promise.all`. Response meta is `{ page, limit, total, totalPages, hasNext, hasPrev }`.

The Zod schema is built with one helper from F2: `buildListQuerySchema({ sortable: [...], defaultSort: 'createdAt', filters: { ... } })`.

### 3.3 Envelopes and domain error codes

Use the envelopes from the rules. Domain codes added to the shared `ErrorCode` union so the frontend can branch on them:

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod failure, with `{ field, message }` details |
| `NOT_FOUND` | 404 | Missing, soft-deleted, or not owned by the customer |
| `DUPLICATE` | 409 | Unique violation |
| `IN_USE` | 409 | Delete blocked because the record is referenced |
| `INVALID_STATE_TRANSITION` | 409 | Workflow action not allowed from the current status |
| `ACTION_NOT_ALLOWED_BY_PLAN` | 409 | Pause, close or renew blocked by plan flags |
| `PLAN_NOT_AVAILABLE` | 409 | Start date outside the plan availability window |
| `QUOTATION_EXPIRED` | 409 | Confirm after `quotationValidUntil` |
| `DISCOUNT_NOT_APPLICABLE` | 409 | Attaching an expired, exhausted or inactive discount |
| `INVOICE_NOT_PAYABLE` | 409 | Payment against a DRAFT, CANCELLED or PAID invoice |
| `OVERPAYMENT` | 400 | Amount greater than `amountDue` |
| `BILLING_RUN_IN_PROGRESS` | 409 | A run for the same date is already RUNNING |
| `DELIVERY_FAILED` | 503 | Invoice email could not be sent. Retryable |

### 3.4 Money, rates, dates

- Money is `Int` paise. Percentages are basis points (18% = 1800). A FIXED tax or discount is paise per unit (tax) or per application (discount).
- Rounding is defined once in `core/utils/money.ts` and nowhere else: `bpsOf(amount, bps) = Math.round(amount * bps / 10000)`. Round per line, then sum the lines. Invoice totals must equal the sum of their lines exactly.
- Line math: `amount = quantity * unitPrice`. Line discount reduces `amount`. Tax is computed on the discounted amount. `total = sum(amount) + sum(taxAmount)`. Subscription-scope discounts are spread across lines proportionally with the last line absorbing the remainder.
- Dates are stored in UTC. A date-only value is normalized to UTC midnight of that calendar date. Business `today` is computed in `APP_TIMEZONE` (default `Asia/Kolkata`).
- Billing periods are computed from an anchor (`startDate`), not from the previous period, so month-end does not drift (31 Jan, 28 Feb, 31 Mar). One helper: `periodStart(anchor, period, index)` in `core/utils/dates.ts`.

### 3.5 Shared types folder (`shared/src/types`)

Frontend imports request and response types from `@brightloop/shared`. Rules:

- One file per feature: `shared/src/types/<feature>.ts`. Only that module's owner edits it.
- Naming: `<X>Dto` (detail), `<X>ListItemDto` (list row), `Create<X>Request`, `Update<X>Request`, `List<X>Query`, `<X>Action<Name>Request`. Responses are wrapped by `ApiSuccess<T>` from `common.ts`.
- Types are plain TypeScript. No Zod and no Prisma types in shared. Enums are `as const` objects plus a union type, mirrored from the schema.
- Dates are `IsoDateTime` strings. Money is `Paise`. Rates are `BasisPoints`.
- Backend Zod schemas must stay in sync. Each `<feature>.schema.ts` ends with a compile-time check that `z.infer<typeof createXSchema>` is assignable to `CreateXRequest`. A mismatch fails typecheck.
- Staff, portal and admin shapes are separate types when fields differ (`ProductDto` vs `ProductAdminDto`, `SubscriptionDto` vs `PortalSubscriptionDto`).
- Barrel: `shared/src/types/index.ts` contains only one `export * from './<feature>.js'` line per feature.

`common.ts` content (owned by F1):

```ts
export type Paise = number;
export type BasisPoints = number;
export type IsoDateTime = string;
export interface PaginationMeta { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean }
export interface ApiSuccess<T> { success: true; message: string; data: T; meta?: PaginationMeta }
export interface ApiFailure { success: false; message: string; error: { code: ErrorCode; details?: { field: string; message: string }[] } }
export interface ListQuery<S extends string> { page?: number; limit?: number; search?: string; sortBy?: S; sortOrder?: 'asc' | 'desc' }
```

## 4. Module boundaries, gateways and atomic-write exceptions

Modules talk through gateway interfaces, declared in `modules/<feature>/<feature>.gateway.ts` (types only) and wired in `container.ts`. A consumer imports the gateway type, never the other module's class.

| Gateway (owner) | Methods | Consumers |
|---|---|---|
| `AuditGateway` (audit) | `record({ actor, action, entityType, entityId, metadata })` | every mutating module |
| `SequenceGateway` (sequences) | `next(key): Promise<string>` | subscriptions |
| `CustomersGateway` (customers) | `getById(id)`, `getOrCreateForUser(userId)`, `snapshot(id)` | subscriptions, invoices, payments, portal |
| `CatalogGateway` (products) | `getPricedItem(productId, variantId?)` returns `{ name, unitPrice, isActive }` | subscriptions, templates |
| `TaxesGateway` (taxes) | `getByIds(ids)` | subscriptions, invoices |
| `PaymentTermsGateway` (payment-terms) | `getById(id)`, `getDefault()` | subscriptions, invoices |
| `PlansGateway` (plans) | `getById(id)`, `assertAvailable(id, date)` | subscriptions, templates |
| `TemplatesGateway` (quotation-templates) | `getWithLines(id)` | subscriptions |
| `DiscountsGateway` (discounts) | `evaluate({ subscriptionId, lines, asOf })` returns applications (pure read, no writes) | invoices, subscriptions preview |
| `SubscriptionsGateway` (subscriptions) | `getForBilling(id)`, `listDueIds(asOf, afterId, limit)`, `closeBySystem(id, reason)`, `listAutoCloseIds(asOf)` | invoices, billing-runs, jobs |
| `InvoicesGateway` (invoices) | `generateForSubscription(id, asOf, opts)` returns `CREATED` or `SKIPPED` or throws | billing-runs |

### Atomic-write exceptions (documented departure from the repository rule)

| Owning repository | May also write | Why |
|---|---|---|
| invoices | `InvoiceLine`, `DiscountUsage`, `Discount.usedCount` (conditional update: `usedCount < usageLimit`), `Subscription.nextBillingDate` and `lastBilledUntil`, `NumberSequence` | One transaction per generated invoice. No double billing, no lost discount usage, consecutive invoice numbers |
| payments | `Invoice.amountPaid`, `amountDue`, `status`, `paidAt` (conditional update: `amountDue >= amount`) | Payment and invoice balance must change together |
| staff | `Session.revokedAt` | Deactivating or deleting staff revokes their sessions in the same transaction |

No other cross-table writes are allowed.

## 5. Working in parallel without conflicts

1. **Ownership.** An owner edits only `modules/<feature>/`, `shared/src/types/<feature>.ts` and `docs/<feature>.md`.
2. **Shared touchpoints are append-only.** `container.ts` (one labelled block per module between marker comments), `app.ts` (one mount line), `shared/src/types/index.ts` (one export line). Merge conflicts here are resolved by keeping both lines.
3. **Schema changes.** Only through a PR labelled `schema`, merged one at a time by the F0 owner. After merge, everyone rebases. Never merge `contract.json`, `contract.d.ts` or migration snapshots by hand: regenerate them. Migrations are planned and applied by one person from main: emit, plan, inspect, migrate, verify.
4. **Interface first.** On day one each owner merges the gateway file and the shared types file (types only, no logic). Dependents build against those with in-memory fakes and do not wait for the real module.
5. **Change policy for published contracts.** After merge, shared types and gateways change additively only. A breaking change needs a note in the PR and approval from each consumer's owner.
6. **Route prefixes** are owned by exactly one module. `/portal/*` and `/me` belong to the portal module only.
7. **PR hygiene.** Branch `feat/<module>-<task>`. Target at most 500 changed lines. CI runs typecheck, lint and `bun run test`. A module PR is merged only when its Definition of Done (section 10) is met.
8. **Arbitration.** The Foundation owner decides disputes about conventions.

## 6. Foundation tasks (Wave 0, merge before any module)

| ID | Task | Deliverable |
|---|---|---|
| F0 | **Schema port and migration.** Copy the schema into `contract.prisma`. Add indexes: `Subscription(customerId, status)`, `Invoice(customerId, status)`, `Invoice(status, issueDate)`. Map existing roles (USER to CUSTOMER, MANAGER to STAFF). Run emit, plan, inspect, migrate, verify. | Migration package, migration note stating generated, applied and verified |
| F1 | **Shared base and roles.** Create `shared/src/types/common.ts`, `enums.ts`, `error-codes.ts`, `index.ts`. Rename `Role` to CUSTOMER, STAFF, ADMIN. Update auth signup default, the admin seed, and the existing users router. In the auth service live-user check, reject `isActive = false` (second and last auth touchpoint). | Shared base types, auth tests still green |
| F2 | **Core utils.** `list-query.ts` (the `buildListQuerySchema` helper and a comma-enum parser), `money.ts`, `dates.ts`, `actor.ts`, `domain-errors.ts` (factories for the codes in 3.3). Reuse the existing pagination helper. | Unit tests: rounding, month-end periods (31 Jan, 28 Feb, 31 Mar), leap years, comma-enum parsing, limit above 100 rejected |
| F3 | **Audit module.** `AuditGateway.record`. Route `GET /api/v1/audit-logs`, A only. Search: `action`. Filters: `userId`, `action`, `entityType`, `entityId`, `createdFrom/To`. Sort: `createdAt`. Writes never block the main operation's success path but their failure is logged. | Module, types, tests |
| F4 | **Sequences module.** `SequenceGateway.next(key)` returns `SUB-2026-000123` or `INV-2026-000456`. Year rollover resets to 1 with a conditional update. Invoices use the same table inside their own transaction (section 4). | Module and concurrency test: 50 parallel calls give 50 unique numbers |
| F5 | **Test harness.** Ephemeral Express listener helper, token helper per role (A, S, C), fake-repository builders, and `seed:perf` that creates 5k customers, 10k subscriptions, 30k invoices and payments in a dev database only, scoped to its own records. | Helpers and perf seed script |
| F6 | **Wiring skeleton.** `container.ts` with one empty labelled block per module, `app.ts` with one commented mount line per module. | Skeleton merged so modules only fill their own block |

Foundation unverified dependency: confirm the installed Prisma 8 contract client supports an atomic increment. If it does not, F4 uses a parameter-bound raw SQL `UPDATE ... RETURNING` inside the transaction.

## 7. Module task cards

Every module contains `<feature>.routes.ts`, `.service.ts`, `.repository.ts`, `.schema.ts`, `.dto.ts`, `.test.ts`, a `.gateway.ts` if it exposes one, plus `shared/src/types/<feature>.ts` and `docs/<feature>.md`. Every card below lists only what is specific to that module. Every list endpoint follows 3.2, every mutation writes an audit entry, and every route follows the middleware order in 3.1.

**Waves.** Wave 1: M1 to M5 run in parallel. Wave 2: M6 to M8. Wave 3: M9. Wave 4: M10, M12, then M11. Wave 5: M13, M14, jobs.

### M1. Taxes (Wave 1)

Path `/api/v1/taxes`. Exposes `TaxesGateway`. Depends on F1 to F3.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| GET | `/:id` | A, S | |
| POST | `/` | A | `name`, `type`, `rate`, `isActive` |
| PATCH | `/:id` | A | |
| DELETE | `/:id` | A | 409 `IN_USE` if any line references it. Prefer `isActive=false` |

- List: `search` name. Filters: `type`, `isActive`. Sort: `name`, `rate`, `createdAt`.
- Rules: `name` unique (409 `DUPLICATE`). PERCENTAGE `rate` 0 to 10000 bps. FIXED `rate` at least 0 paise per unit. Editing or deactivating a tax never changes existing lines because they hold a snapshot.
- Shared types: `TaxDto`, `CreateTaxRequest`, `UpdateTaxRequest`, `ListTaxesQuery`.
- Tests: RBAC matrix (A, S, C, no token), duplicate name, in-use delete.

### M2. Payment terms (Wave 1)

Path `/api/v1/payment-terms`. Exposes `PaymentTermsGateway`.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| GET | `/:id` | A, S | |
| POST | `/` | A | `name`, `dueDays`, `isDefault`, `isActive` |
| PATCH | `/:id` | A | |
| DELETE | `/:id` | A | 409 `IN_USE` if referenced or if it is the default |

- List: `search` name. Filters: `isActive`, `isDefault`. Sort: `name`, `dueDays`, `createdAt`.
- Rules: `dueDays` 0 to 365. At most one default: setting `isDefault=true` clears the previous default in one repository transaction. Subscriptions without a term use the default.
- Shared types: `PaymentTermDto`, `CreatePaymentTermRequest`, `UpdatePaymentTermRequest`, `ListPaymentTermsQuery`.

### M3. Products and variants (Wave 1)

Path `/api/v1/products`. Exposes `CatalogGateway`.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List. `include=variants` |
| GET | `/:id` | A, S | With variants |
| POST | `/` | A | Accepts optional `variants[]` in the same transaction |
| PATCH | `/:id` | A | |
| DELETE | `/:id` | A | Soft delete |
| GET | `/:productId/variants` | A, S | List |
| POST | `/:productId/variants` | A | `attribute`, `value`, `extraPrice` |
| PATCH | `/:productId/variants/:variantId` | A | |
| DELETE | `/:productId/variants/:variantId` | A | 409 `IN_USE` if referenced. Prefer `isActive=false` |

- Product list: `search` name and notes. Filters: `type`, `isActive`, `minPrice`, `maxPrice`. Sort: `name`, `salesPrice`, `createdAt`.
- Variant list: `search` attribute and value. Filter: `isActive`. Sort: `attribute`, `value`, `extraPrice`.
- Rules: prices at least 0. Variant unique on (product, attribute, value), else 409. Final unit price = `salesPrice + extraPrice`, for example Odoo brand: 56000 paise added. Inactive or soft-deleted products and variants cannot be added to new lines; existing lines are unaffected. `getPricedItem` rejects a variant that does not belong to the product.
- Access detail: S receives `ProductDto` without `costPrice`. A receives `ProductAdminDto`.
- Shared types: `ProductDto`, `ProductAdminDto`, `ProductVariantDto`, `CreateProductRequest`, `UpdateProductRequest`, `CreateVariantRequest`, `UpdateVariantRequest`, `ListProductsQuery`, `ListVariantsQuery`.

### M4. Staff (Wave 1)

Path `/api/v1/staff`. All routes A only. Depends on F1.

| Method | Path | Notes |
|---|---|---|
| GET | `/` | List |
| GET | `/:id` | |
| POST | `/` | `name`, `email`, `username?`, `password` |
| PATCH | `/:id` | `name`, `username` |
| POST | `/:id/deactivate` | Sets `isActive=false`, revokes all sessions in one transaction |
| POST | `/:id/activate` | |
| DELETE | `/:id` | Soft delete plus session revoke |

- List: `search` name, email, username. Filter: `isActive`. Sort: `name`, `email`, `createdAt`, `lastLoginAt`.
- Rules: role is always STAFF and never accepted from the body. Password uses the same policy as signup and the 72-byte bcrypt limit. `emailVerifiedAt` is set at creation. Email is unique including soft-deleted users (409). An admin cannot deactivate or delete themselves. This module only sees users with role STAFF; ADMIN and CUSTOMER ids return 404.
- Shared types: `StaffDto`, `CreateStaffRequest`, `UpdateStaffRequest`, `ListStaffQuery`.
- Tests: deactivated staff token is rejected on the next request, self-deactivation blocked, S and C get 403.

### M5. Customers (Wave 1)

Path `/api/v1/customers`. Exposes `CustomersGateway`. Depends on F1 to F3.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List. `include=summary` |
| GET | `/:id` | A, S | With summary |
| POST | `/` | A, S | |
| PATCH | `/:id` | A, S | |
| DELETE | `/:id` | A | Soft delete. 409 `IN_USE` if ACTIVE or PAUSED subscriptions or unpaid invoices exist |

- List: `search` name, companyName, email, phone, taxId. Filters: `hasPortalAccount`, `hasOutstanding`, `city`, `state`, `createdFrom/To`. Sort: `name`, `companyName`, `createdAt`.
- Summary: `activeSubscriptions`, `outstandingAmount`, `overdueCount`. Computed with grouped queries for the page's ids, at most 3 extra queries per page, never one per row.
- Rules: on create, if a `User` with the same email exists and has no customer, link `userId`. `userId` is never accepted from the body. `getOrCreateForUser` builds the customer from the user's name and email.
- Shared types: `CustomerDto`, `CustomerListItemDto`, `CustomerSummaryDto`, `CreateCustomerRequest`, `UpdateCustomerRequest`, `ListCustomersQuery`.

### M6. Plans (Wave 2)

Path `/api/v1/plans`. Exposes `PlansGateway`. Depends on F1 to F3.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| GET | `/:id` | A, S | Includes `activeSubscriptionCount` |
| POST | `/` | A | |
| PATCH | `/:id` | A | |
| DELETE | `/:id` | A | Soft delete. 409 `IN_USE` if non-closed subscriptions exist |

- List: `search` name and description. Filters: `billingPeriod`, `isActive`, `availableOn` (date), `autoClose`, `closable`, `pausable`, `renewable`. Sort: `name`, `price`, `availableFrom`, `createdAt`.
- Rules: `availableTo` after `availableFrom`. `minQuantity` at least 1. `price` at least 0. `billingPeriod` cannot change while non-closed subscriptions exist (409 `IN_USE`). Flag changes apply immediately to existing subscriptions. `assertAvailable(planId, date)` returns 409 `PLAN_NOT_AVAILABLE`.
- Shared types: `PlanDto`, `CreatePlanRequest`, `UpdatePlanRequest`, `ListPlansQuery`.

### M7. Discounts (Wave 2)

Path `/api/v1/discounts`. Exposes `DiscountsGateway`. Depends on M3 types and F1 to F3.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| GET | `/:id` | A, S | With `productIds` and usage count |
| POST | `/` | A | Includes `productIds[]` when scope is PRODUCT |
| PATCH | `/:id` | A | |
| DELETE | `/:id` | A | Soft delete |
| PUT | `/:id/products` | A | Replace the product set (scope PRODUCT only) |
| POST | `/:id/subscriptions` | A, S | Attach `subscriptionIds[]` (scope SUBSCRIPTION only) |
| DELETE | `/:id/subscriptions/:subscriptionId` | A, S | Detach |
| GET | `/:id/usages` | A, S | List |

- List: `search` name and code. Filters: `type`, `scope`, `isActive`, `state` (`upcoming`, `active`, `expired`, `exhausted`, derived from dates and `usedCount`), `productId`. Sort: `name`, `startDate`, `endDate`, `usedCount`, `createdAt`.
- Usages list: filters `invoiceId`, `subscriptionId`, `createdFrom/To`. Sort: `createdAt`, `amount`.
- Rules: PERCENTAGE `value` 1 to 10000 bps. FIXED `value` at least 1 paise. `endDate` on or after `startDate`. `usageLimit` at least 1 or null for unlimited. `usedCount` is never writable through the API. Scope cannot change once usages exist. Attaching an expired, exhausted or inactive discount returns 409 `DISCOUNT_NOT_APPLICABLE`. Only A creates or edits rules. S may attach an existing rule (change this line in the table if you want A only).
- **Evaluation (`DiscountsGateway.evaluate`, pure read).** Eligible when: active, not deleted, `startDate <= asOf <= endDate`, `usedCount < usageLimit`, quantity at least `minQuantity`, base amount at least `minPurchase`. PRODUCT scope applies to lines whose product is in the set; the base is those lines' amount. SUBSCRIPTION scope applies to subscriptions it is attached to; the base is the subtotal after product discounts. Process in ascending discount id. A discount never exceeds its base. Result: list of `{ discountId, lineId?, amount }`. Invoice generation consumes usage in its own transaction (section 4). Expiry is judged at evaluation time, so no expiry job is needed.
- Shared types: `DiscountDto`, `DiscountUsageDto`, `CreateDiscountRequest`, `UpdateDiscountRequest`, `SetDiscountProductsRequest`, `AttachDiscountSubscriptionsRequest`, `ListDiscountsQuery`, `ListDiscountUsagesQuery`.
- Tests: usage limit reached on the exact last use, discount valid on its end date, minimum equal to the amount, stacking order, cap at base.

### M8. Quotation templates (Wave 2)

Path `/api/v1/quotation-templates`. Exposes `TemplatesGateway`. Depends on M3 and M6 gateways.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| GET | `/:id` | A, S | With lines |
| POST | `/` | A | `name`, `planId`, `validityDays`, `notes`, `lines[]` |
| PATCH | `/:id` | A | If `lines` is sent it replaces all lines in one transaction |
| DELETE | `/:id` | A | Soft delete. Existing subscriptions are unaffected |

- List: `search` name and notes. Filters: `planId`, `isActive`. Sort: `name`, `validityDays`, `createdAt`.
- Rules: `validityDays` 1 to 365. At least 1 line. Products and variants must be active and the variant must belong to the product. Plan must exist and be active.
- Shared types: `QuotationTemplateDto`, `QuotationTemplateLineDto`, `CreateQuotationTemplateRequest`, `UpdateQuotationTemplateRequest`, `ListQuotationTemplatesQuery`.

### M9. Subscriptions (Wave 3)

Path `/api/v1/subscriptions`. Exposes `SubscriptionsGateway`. Depends on M1, M2, M3, M5, M6, M8 gateways and F4.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| POST | `/from-template` | A, S | Creates a DRAFT with plan and lines copied from the template. Register before `/:id` |
| POST | `/` | A, S | Creates a DRAFT |
| GET | `/:id` | A, S | Lines, status history, attached discounts, last 5 invoices |
| PATCH | `/:id` | A, S | DRAFT and QUOTATION: header and lines (lines replaced as a whole). After CONFIRMED only `notes` and `paymentTermId` |
| DELETE | `/:id` | A | Soft delete, DRAFT only |
| POST | `/:id/send-quotation` | A, S | See state table in section 1 |
| POST | `/:id/confirm` | A, S | |
| POST | `/:id/activate` | A, S | |
| POST | `/:id/pause` | A, S | Plan `pausable` |
| POST | `/:id/resume` | A, S | |
| POST | `/:id/close` | A, S | Body `reason`. Plan `closable` from ACTIVE or PAUSED |
| POST | `/:id/renew` | A, S | Plan `renewable`. Returns the new DRAFT |

- List: `search` number, customer name, company name, customer email. Filters: `status` (multi), `customerId`, `planId`, `templateId`, `startFrom/To`, `expiryFrom/To`, `nextBillingFrom/To`, `createdFrom/To`, `dueForBilling` (ACTIVE and `nextBillingDate` on or before today), `expiringWithinDays` (1 to 365). Sort: `number`, `startDate`, `expiryDate`, `nextBillingDate`, `total`, `status`, `createdAt`. `include=lines`.
- Create rules: customer must exist and not be deleted. Plan must be available on `startDate`. Each line quantity at least plan `minQuantity`. The client never sends `unitPrice` or `taxRate`: the server takes the price from `CatalogGateway` and the rate from `TaxesGateway` and stores snapshots. `expiryDate` after `startDate`. A plan with `autoClose` requires `expiryDate`. Payment term defaults to the default term. Number comes from `SequenceGateway`. Totals (`subtotal`, `taxTotal`, `total`, `recurringAmount`) are recomputed on every line change in the same transaction.
- Transitions use a conditional write (`WHERE status = <expected>`). Zero rows updated means 409 `INVALID_STATE_TRANSITION`, so two people confirming at once cannot both succeed.
- Renew: new subscription keeps plan, customer, payment term and lines, re-priced at current prices, start = old `expiryDate` (or today if already past), same duration, `renewedFromId` set.
- Gateway: `getForBilling`, `listDueIds` (keyset on id), `closeBySystem`, `listAutoCloseIds`.
- Shared types: `SubscriptionDto`, `SubscriptionListItemDto`, `SubscriptionLineDto`, `SubscriptionStatusHistoryDto`, `CreateSubscriptionRequest`, `CreateSubscriptionFromTemplateRequest`, `UpdateSubscriptionRequest`, `CloseSubscriptionRequest`, `RenewSubscriptionRequest`, `ListSubscriptionsQuery`.
- Tests: table-driven test of every transition from every status, plan flag blocks, minimum quantity, parallel double confirm, price snapshot unaffected by later product edits.

### M10. Invoices (Wave 4)

Path `/api/v1/invoices`. Exposes `InvoicesGateway`. Depends on M9, M7, M1, M2, M5 gateways and F4. There is no DELETE: invoices are cancelled, never deleted.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| GET | `/preview` | A, S | `?subscriptionId=`. Computes the next invoice without writing. Register before `/:id` |
| POST | `/generate` | A, S | Body `subscriptionId`, `asOf?`, `autoConfirm?`. 201 with the invoice. 409 `NOTHING_TO_BILL` or `ALREADY_BILLED` otherwise |
| GET | `/:id` | A, S | Lines, payments, discount usages |
| PATCH | `/:id` | A, S | DRAFT only: `notes`, `dueDate` |
| POST | `/:id/confirm` | A, S | |
| POST | `/:id/cancel` | A, S | Body `reason`. 409 if a payment exists |
| POST | `/:id/send` | A, S | Email. 503 `DELIVERY_FAILED` leaves `sentAt` unset and is retryable |
| GET | `/:id/print` | A, S | Returns `InvoicePrintDto` |

- List: `search` number, customer name, customer email. Filters: `status` (multi), `customerId`, `subscriptionId`, `issueFrom/To`, `dueFrom/To`, `overdue`, `outstanding`, `billingRunId`, `minTotal`, `maxTotal`. Sort: `number`, `issueDate`, `dueDate`, `total`, `amountDue`, `status`, `createdAt`. Every row carries computed `isOverdue` and `daysOverdue`.
- **Generation algorithm** (one code path for the manual endpoint and the billing run):
  1. Load through `getForBilling`. Subscription must be ACTIVE with `nextBillingDate` on or before `asOf` and, if `expiryDate` is set, on or before it. Otherwise return SKIPPED with a reason.
  2. Period = `[nextBillingDate, next boundary)` computed from the `startDate` anchor. `periodEnd` is the exclusive end.
  3. Build lines from the subscription lines (`amount = quantity * unitPrice`). Call `DiscountsGateway.evaluate`. Compute tax on the discounted amounts. Totals equal the sum of the lines. `dueDate = issueDate + paymentTerm.dueDays`. Copy the customer snapshot.
  4. One repository transaction: allocate the invoice number, insert the invoice (a unique violation on subscription and period means SKIPPED `ALREADY_BILLED` with nothing else committed), insert lines, insert `DiscountUsage` rows, increment `usedCount` with the conditional update (if it fails because the limit was just reached, roll back and retry once without that discount), advance `nextBillingDate` and `lastBilledUntil`.
  5. With `autoConfirm` set the status is CONFIRMED, otherwise DRAFT.
  6. One period per call. The billing run loops for catch-up (section M11).
- Cancel reverses `DiscountUsage` rows and `usedCount` in the same transaction. The subscription's `nextBillingDate` is not moved back (decision 10).
- Send uses the existing EmailJS mailer interface with a new invoice template. A failed delivery never changes invoice state.
- `InvoicePrintDto` holds company details from env, invoice number and dates, customer snapshot, lines, tax summary grouped by rate, totals, payments received and balance. The frontend formats currency and prints.
- Shared types: `InvoiceDto`, `InvoiceListItemDto`, `InvoiceLineDto`, `InvoicePreviewDto`, `InvoicePrintDto`, `GenerateInvoiceRequest`, `UpdateInvoiceRequest`, `CancelInvoiceRequest`, `ListInvoicesQuery`. Add `NOTHING_TO_BILL` and `ALREADY_BILLED` to `ErrorCode` (additive).
- Tests: 20 parallel `generate` calls give exactly one invoice. Totals equal line sums for awkward rates (for example 18% of 33333 paise). Discount used exactly at its limit. Month-end periods. Cancel restores discount usage. Send failure leaves `sentAt` null.

### M11. Billing runs (Wave 4, after M10)

Path `/api/v1/billing-runs`. Depends on M9 and M10 gateways.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| GET | `/:id` | A, S | Counters and status |
| GET | `/:id/items` | A, S | List |
| POST | `/` | A, S | Body `runDate?` (default today, not in the future), `autoConfirm?`, `subscriptionIds?`. Returns 201 with status RUNNING |
| POST | `/:id/retry-failed` | A, S | Reprocesses FAILED items |

- List: filters `status` (multi), `runFrom/To`, `triggeredById`. Sort: `runDate`, `startedAt`, `createdCount`, `status`. Items: filters `status`, `subscriptionId`; `search` subscription number and message; sort `id`, `status`.
- Processing: keyset batches of `BILLING_BATCH_SIZE` through `listDueIds`. One transaction per subscription, so one failure never blocks the rest. Each result becomes a `BillingRunItem` (CREATED, SKIPPED, FAILED with a sanitized message). A subscription with several overdue periods is processed in a loop until `nextBillingDate` passes the run date, capped at `BILLING_MAX_CATCHUP_PERIODS` (default 12). Final status: COMPLETED, PARTIAL (some failed) or FAILED.
- Concurrency: 409 `BILLING_RUN_IN_PROGRESS` if a RUNNING run exists for the same date, checked in a repository transaction. Correctness never depends on that check, because the invoice unique constraint blocks double billing.
- Recovery: on server start, runs RUNNING for longer than `BILLING_STUCK_RUN_MINUTES` are marked FAILED. Re-running is always safe.
- Shared types: `BillingRunDto`, `BillingRunItemDto`, `CreateBillingRunRequest`, `ListBillingRunsQuery`, `ListBillingRunItemsQuery`.
- Tests: run twice on one date creates 0 invoices the second time. One failing subscription does not stop the run. 500 due subscriptions complete. A stuck run is recovered.

### M12. Payments (Wave 4)

Path `/api/v1/payments`. Uses the payments atomic-write exception (section 4).

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | A, S | List |
| GET | `/:id` | A, S | |
| POST | `/` | A, S | `invoiceId`, `method`, `amount`, `paymentDate`, `reference?`, `note?` |
| PATCH | `/:id` | A, S | `note` and `reference` only. Amount, date and invoice are immutable |
| DELETE | `/:id` | A | Reverses a mistaken payment |

- List: `search` reference, note, invoice number, customer name. Filters: `invoiceId`, `customerId`, `method` (multi), `paidFrom/To` (on `paymentDate`), `minAmount`, `maxAmount`. Sort: `paymentDate`, `amount`, `createdAt`.
- Create is one transaction: conditional update on the invoice (`status = CONFIRMED AND amountDue >= amount`) adding to `amountPaid` and subtracting from `amountDue`, then the payment insert, then status PAID with `paidAt` when `amountDue` reaches 0. Zero rows updated is diagnosed afterwards: not payable returns 409 `INVOICE_NOT_PAYABLE`, too large returns 400 `OVERPAYMENT`. `customerId` is copied from the invoice. `paymentDate` cannot be in the future. `amount` at least 1 paise. `recordedById` is the actor.
- Delete reverses the balance, moves PAID back to CONFIRMED, and stores the full deleted payment in the audit entry metadata.
- Shared types: `PaymentDto`, `PaymentListItemDto`, `CreatePaymentRequest`, `UpdatePaymentRequest`, `ListPaymentsQuery`.
- Tests: two parallel payments that together exceed the balance give exactly one success. Exact payment gives PAID. Partial payment leaves the correct balance. Delete restores state. Payment on a DRAFT invoice is rejected.

### M13. Customer portal (Wave 5)

Prefix `/api/v1/portal` and `/api/v1/me`. Every route is `requireRoles(Role.CUSTOMER)`. Handlers are thin and call the existing services with an `Actor`. Portal DTO mappers strip internal fields (`notes`, `createdById`, `billingRunId`, cost data).

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Profile from the customer record plus user email |
| PATCH | `/me` | `name`, `companyName`, `phone`, address fields, `taxId`. Email change is out of scope |
| GET | `/portal/summary` | Active subscriptions, next billing date, outstanding amount, overdue count and amount |
| GET | `/portal/subscriptions` | Filters `status`, `planId`. `search` number. Sort `startDate`, `expiryDate`, `nextBillingDate`, `status`, `createdAt` |
| GET | `/portal/subscriptions/:id` | |
| POST | `/portal/subscriptions/:id/pause` | Plan flag applies |
| POST | `/portal/subscriptions/:id/resume` | |
| POST | `/portal/subscriptions/:id/close` | Plan flag applies. Body `reason?` |
| POST | `/portal/subscriptions/:id/renew` | Plan flag applies |
| GET | `/portal/invoices` | Status limited to CONFIRMED and PAID. Filters `status`, `overdue`, `outstanding`, `subscriptionId`, `issueFrom/To`, `dueFrom/To`. `search` number. Sort `issueDate`, `dueDate`, `total`, `amountDue` |
| GET | `/portal/invoices/:id` | |
| GET | `/portal/invoices/:id/print` | |
| GET | `/portal/payments` | Filters `invoiceId`, `method`, `paidFrom/To`. Sort `paymentDate`, `amount` |

- Rules: `customerId` always comes from the actor through `getOrCreateForUser`. Customers never see DRAFT subscriptions, or DRAFT and CANCELLED invoices. Another customer's id returns 404. Password change stays in auth.
- Decision to confirm: portal renew creates the new subscription and activates it straight away (start date = old expiry, so nothing bills early), because the customer's request is the approval. Staff renew creates a DRAFT.
- Shared types: `PortalProfileDto`, `UpdatePortalProfileRequest`, `PortalSummaryDto`, `PortalSubscriptionDto`, `PortalInvoiceDto`, `PortalPaymentDto`, `ListPortalSubscriptionsQuery`, `ListPortalInvoicesQuery`, `ListPortalPaymentsQuery`.
- Tests: an access test where customer B requests customer A's ids on every portal resource and gets 404. A staff token on `/portal` returns 403. A customer token on `/subscriptions` returns 403.

### M14. Reports (Wave 5)

Path `/api/v1/reports`. All GET, A and S. The reports repository is read-only across tables (add this to the section 4 exception list as read-only).

| Path | Params | Returns |
|---|---|---|
| `/summary` | `from`, `to` (default current month), `planId`, `customerId` | `activeSubscriptions`, `subscriptionsByStatus`, `newSubscriptions`, `closedSubscriptions`, `invoicedAmount`, `revenueReceived`, `outstandingAmount`, `overdueAmount`, `overdueCount`, `mrr`, `arr` |
| `/revenue/timeseries` | `from`, `to`, `interval` (`day`, `week`, `month`), `planId` | Buckets of `{ period, invoiced, received }`. Day interval limited to 366 days |
| `/revenue/by-plan` | `from`, `to` | Per plan: `activeSubscriptions`, `mrr`, `received` |
| `/payments/summary` | `from`, `to` | Per method: `count`, `amount`, plus total |
| `/invoices/overdue` | Standard list params. Filters `customerId`, `subscriptionId`, `minDaysOverdue`, `minAmount`, `dueFrom/To`. `search` number and customer. Sort `daysOverdue`, `amountDue`, `dueDate` | Paginated rows with `daysOverdue` |
| `/aging` | `customerId` | Buckets not yet due, 1 to 30, 31 to 60, 61 to 90, over 90, each `{ count, amount }` |
| `/subscriptions/expiring` | `withinDays` (1 to 365, default 30). Standard list params. Filters `planId`, `customerId`. Sort `expiryDate` | ACTIVE subscriptions expiring soon or already past expiry without `autoClose`. This is the renewals list |

- Definitions: **Revenue received** = sum of `Payment.amount` with `paymentDate` in range. **Outstanding** = sum of `amountDue` on CONFIRMED invoices as of now. **Overdue** = outstanding with `dueDate` before today. **MRR** = sum over ACTIVE subscriptions of `recurringAmount` normalized per month (DAILY x30, WEEKLY x52/12, MONTHLY x1, YEARLY /12, integer paise). **ARR** = MRR x 12.
- Performance: at most 3 aggregate queries per endpoint, run with `Promise.all`, never a query per row. No cache. Verify with `EXPLAIN ANALYZE` on the F5 perf seed. Target p95 under 500 ms at 10k subscriptions and 30k invoices. If a query misses, add an index first.
- Shared types: `ReportSummaryDto`, `RevenueTimeseriesDto`, `RevenueByPlanDto`, `PaymentsSummaryDto`, `OverdueInvoiceDto`, `AgingDto`, `ExpiringSubscriptionDto`, and a query type per endpoint.
- Tests: totals match a hand-computed fixture. Range boundaries are inclusive. Paise totals reconcile: `received + outstanding = invoiced` for confirmed and paid invoices in a fixture.

## 8. Scheduled jobs (Wave 5)

File `core/jobs/scheduler.ts`, started from `server.ts` and stopped in graceful shutdown. A timer ticks every 60 seconds and never throws (errors are logged).

| Job | When | Action |
|---|---|---|
| Billing | After `BILLING_RUN_HOUR_UTC`, once per date. Skips if a run for that date with `triggeredById = null` exists | Calls the same billing-run service as `POST /billing-runs`, with `autoConfirm = false` |
| Lifecycle | Same tick | For each id in `listAutoCloseIds(today)` call `closeBySystem(id, 'Plan ended')`. Writes history and audit |
| Recovery | On start | Marks stuck RUNNING billing runs FAILED |

Two instances firing together cannot double-bill: the invoice unique constraint and the `BillingRunItem` unique constraint absorb it. Switch off with `BILLING_SCHEDULER_ENABLED=false`.

## 9. Testing requirements

- **RBAC matrix.** For every route, generated from a route table: no token gives 401, a disallowed role gives 403, an allowed role gives 2xx or the expected business error.
- **Lists.** `limit=101` gives 400. A page past the end gives empty `data` with correct meta. A `sortBy` outside the whitelist gives 400. Search is case-insensitive. Soft-deleted rows never appear. Order is stable across pages.
- **Concurrency.** Parallel generate, confirm, pay and number allocation (listed per module).
- **Money.** Totals equal line sums. No float arithmetic anywhere. Every stored money and rate value is an integer.
- **Performance.** After `seed:perf`, every list and report endpoint responds under 2 seconds, target under 500 ms.
- Unit tests mock repositories and mailers. Integration tests use an ephemeral Express listener and fixtures scoped to their own records. No real emails in tests.

## 10. Definition of Done (every module PR)

1. Routes follow the middleware order, roles match the card, ownership is checked in the service.
2. Zod validation on body, query and params. Lists bounded and following 3.2.
3. Shared types file merged and the Zod-to-shared compile check passes.
4. Errors use the domain codes. No raw database errors reach the client.
5. Mutations write audit entries. No secrets or tokens in logs.
6. Tests listed on the card pass (`bun run test`). Typecheck and lint pass.
7. `docs/<feature>.md` holds endpoints, roles, example request and response, and the module's error codes.
8. PR description lists: files, schemas and shared types, schema or migration note, RBAC table, new env vars, example requests, and anything unverified.

## 11. New environment variables (no values here)

`APP_TIMEZONE`, `DEFAULT_CURRENCY`, `APP_PUBLIC_URL`, `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_TAX_ID`, `BILLING_SCHEDULER_ENABLED`, `BILLING_RUN_HOUR_UTC`, `BILLING_BATCH_SIZE`, `BILLING_MAX_CATCHUP_PERIODS`, `BILLING_STUCK_RUN_MINUTES`, `EMAILJS_INVOICE_TEMPLATE_ID`. The invoice template parameters are `to_email`, `name`, `invoice_number`, `total`, `due_date`, `portal_url`. Validate all in `config/env.ts` with Zod.

## 12. Suggested split across five developers

| Dev | Tasks | Waits for |
|---|---|---|
| P1 | F0 to F6, then M4 Staff, then M14 Reports | Nothing. Everyone else waits for F0 to F2 |
| P2 | M1 Taxes, M2 Payment terms, M3 Products, M6 Plans, M8 Templates | F1 to F3 |
| P3 | M5 Customers, M7 Discounts, then M13 Portal | F1 to F3. M13 waits for M9 and M10 |
| P4 | M9 Subscriptions, M11 Billing runs, section 8 jobs | M1 to M8 gateways (fakes until merged). M11 waits for M10 |
| P5 | M10 Invoices, M12 Payments | M9 gateway and M7 gateway (fakes until merged) |

Day 1 for everyone: merge your gateway file and shared types file (types only) so the others can code against them. P4 and P5 agree the `SubscriptionsGateway` and `InvoicesGateway` signatures on day one, because M9, M10 and M11 depend on each other's shapes.

## 13. Open items needing your decision

1. Int or BigInt for money fields (before F0).
2. Staff can attach discounts to subscriptions (current default) or only the admin.
3. Portal renew auto-activates (current default) or creates a DRAFT for staff.
4. Cancelled invoice periods are not re-billed (decision 10). Say so if you need re-billing.
5. Admin sets the staff initial password with no forced change, or add `mustChangePassword`.
6. Unverified: atomic increment support in the installed contract client (F4), and whether the existing mailer interface accepts a second EmailJS template id.
