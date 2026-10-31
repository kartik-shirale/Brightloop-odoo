# Shared API contracts

`@brightloop/shared` is the common JSON API contract for **both** `@odoo/core` and
`@odoo/web`. Neither consumer imports the other's implementation. The package has
no runtime dependencies on Prisma, Express, React, Zod, or database code.

The contract follows `apps/core/src/prisma/contract.prisma`,
`docs/plan/backend.md`, and `docs/plan/frontend.md`. Business modules described in
those plans are **planned endpoints**: publishing their types does not implement
their handlers. Existing authentication/users exports and `API_ROUTES` remain
compatible.

## Imports and ownership

```ts
// Identical import in a backend service/schema/mapper or frontend client/hook.
import type {
  CreateSubscriptionRequest,
  SubscriptionDto,
  ApiSuccess,
  ListSubscriptionsQuery,
} from '@brightloop/shared';
import { SubscriptionStatus, SubscriptionAction } from '@brightloop/shared';
```

`src/types/index.ts` exports every feature; `src/index.ts` exports the package.
Keep feature contracts here and runtime validation in the owning app. Do not
export raw database rows, token hashes, password hashes, or repositories.
`Session` and password reset storage records deliberately have no public row DTO;
`SessionDto` exposes only safe session information. Number sequences are internal;
`SequenceKey` is shared for enum consistency, with no public sequence endpoint.

| Files under `src/types/` | Contract coverage |
| --- | --- |
| `common`, `api`, `list-meta`, `error-codes`, `enums` | Envelopes, pagination, wire primitives, schema enums, errors, action enums |
| `auth` | Existing auth, sessions, users and compatible `*Request` aliases |
| `taxes`, `payment-terms`, `products`, `plans` | Configuration, role-specific product pricing, variants |
| `staff`, `customers`, `audit` | Staff administration, customers, summaries, audit reads |
| `discounts`, `quotation-templates` | Discount rules/attachments/usages and template lines |
| `subscriptions`, `invoices` | Lines, lifecycle, history, previews, print, generation/actions |
| `payments`, `billing-runs` | Immutable payment amounts, run counters and items |
| `portal` | Explicit customer-safe profile, subscription, invoice and payment views |
| `reports` | Summary, timeseries, plan revenue, payment summary, overdue, aging, renewals |
| `endpoints` | Method/path registry and request/response lookup helpers |

## Use the same types on each side

Backend schemas validate unknown HTTP input and their inferred output must be
assignable to the shared request type. Check this in the owning module:

```ts
import type { z } from 'zod';
import type { CreateTaxRequest, TaxDto, SuccessResponseFor } from '@brightloop/shared';

// In taxes.schema.ts, after defining createTaxSchema:
type Assert<T extends true> = T;
export type CreateTaxSchemaCheck = Assert<
  z.output<typeof createTaxSchema> extends CreateTaxRequest ? true : false
>;

// In the mapper/handler, build the public projection explicitly.
const data = {
  id: row.id,
  name: row.name,
  type: row.type,
  rate: row.rate,
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
} satisfies TaxDto;
const response = {
  success: true,
  message: 'Tax fetched',
  data,
} satisfies SuccessResponseFor<'GET /api/v1/taxes/:id'>;
```

Frontend clients use the same endpoint lookup, with no backend imports:

```ts
import type { RequestBodyFor, ResponseFor } from '@brightloop/shared';

// `client` is the frontend's shared HTTP client; calls remain in core/api.
export async function createSubscription(
  body: RequestBodyFor<'POST /api/v1/subscriptions'>,
) {
  const { data } = await client.post<
    ResponseFor<'POST /api/v1/subscriptions'>
  >('/api/v1/subscriptions', body);
  return data;
}
```

Other helpers are `RequestQueryFor<K>`, `RequestParamsFor<K>`, `RequestFor<K>`,
`SuccessResponseFor<K>`, and `ResponseDataFor<K>`. `RequestFor` combines numeric
path IDs, body and query, requiring only the parts the endpoint accepts. These
types are compile-time contracts, not HTTP clients, route registration, RBAC, or
runtime response validation.

## Wire conventions

- Money is an integer JSON number in **paise** (`Paise`). Percentage rates are
  **basis points** (`BasisPoints`): 18% = 1800. `Tax.rate` and `Discount.value`
  retain the schema's names: percentage means bps, fixed means paise. These are
  number aliases; validators still enforce integer, bounds and safe arithmetic.
- Responses contain UTC ISO 8601 strings (`IsoDateTime`), never `Date` or `bigint`.
  Business-date inputs accept YYYY-MM-DD or an ISO timestamp (`DateInput`). Range
  bounds are inclusive; a date-only upper bound means the end of that day.
  Invoice `periodEnd` is an **exclusive** billing boundary, not a range filter.
- Query objects contain numbers, booleans and arrays. The HTTP client serializes
  enum/include arrays as comma-separated values and booleans as `true`/`false`.
  Omit undefined values. Raw Express query strings must be parsed and validated
  before being treated as these types.
- Omitted patch fields are unchanged. `null` explicitly clears a nullable field.
  Optional line arrays replace the entire line set. Subscription lines never
  accept prices/totals; missing or null `taxId` means no tax. Runtime validation
  enforces minimum quantities, nonempty line sets, dates and workflow permissions.
- Every paginated list uses `ApiListSuccess<Row>` with required `data` and `meta`.
  Single-resource/actions returning a resource use `ApiSuccess<Dto>`. Deletes and
  existing logout/reset actions use `ApiMessageSuccess`, with no `data` field.
  Aggregate report arrays use `ApiSuccess` without pagination. Timeseries periods
  are ISO bucket-start timestamps; revenue-by-plan returns an array;
  payment summary is `{ byMethod, total }`; aging has five named buckets.
- `ApiFailure` has typed error codes and field errors, plus the existing internal
  error fingerprint and development mail-provider diagnostic shapes. Branch on
  `error.code` before interpreting `details`. Legacy `ApiError`/`ApiEnvelope`
  remain broad because existing auth errors may contain diagnostic details.
  Legacy `ApiResponse<T>` retains optional `data`; new endpoint contracts use the
  stricter envelopes. The existing users list retains `order`; new lists use
  `sortOrder`.
- `BillingRun.totalDue` is a **subscription count**, not paise. Billing runs have
  `startedAt`, not `createdAt`. Derived overdue flags/counts and allowed actions
  are supplied by the backend, never independently calculated for authorization
  in the frontend.

## Public projections and workflow decisions

`ProductDto` is safe for STAFF; ADMIN receives `ProductAdminDto` with cost price.
Product detail variants are required; list variants are optional unless included.
`ProductDtoFor<Role>` and `ProductDetailDtoFor<Role>` support already-narrowed
actors. The endpoint registry uses the union because the same URL serves both
roles. A union does not grant permission; backend mappers must pick the right view.

Portal types explicitly list public fields, rather than deriving themselves by
omitting current private staff fields. `PortalProfileDto.id` is the customer ID.
Portal subscription status excludes DRAFT; portal invoice status is CONFIRMED or
PAID. Portal inputs never accept another customer's ID, linking IDs, email
changes or internal notes. Print data excludes staff notes and audit identifiers.
TypeScript is structurally typed: assigning a database object to a DTO type does
**not** remove its extra properties at runtime. Always construct allowlisted DTOs.

`SubscriptionAction` and `InvoiceAction` are API-only uppercase string constants.
`allowedActions` is evaluated by the server for the actor, state and plan flags.
Portal actions are restricted to PAUSE, RESUME, CLOSE and RENEW. Staff close
requires a reason; portal close accepts an optional reason. Renewal requests
have no editable fields; the server derives dates, lines and prices. Staff renew
returns the new subscription; the portal contract returns a customer-visible
subscription. The plan's proposed automatic portal activation remains a service
decision: these types do not implement or approve that behavior.

`GET /discounts/:id/subscriptions` appears only in the frontend's additive
requests. Its types live in `ProposedApiContracts`, separate from `ApiContracts`,
until the backend plan adopts the endpoint. Attachment mutations return the
updated discount and detach/delete actions are message-only. Retry-failed billing
returns the run counters/status so polling can resume. These fill response-shape
gaps in the plans without implementing the corresponding operations.

Tax line snapshots follow the schema: `taxRate` is basis points and `taxAmount`
is paise. The schema does not store historical tax names/types/fixed rates on
lines. The invoice owner must address snapshot fidelity before implementing
historical print summaries; reading a mutable tax rule cannot reconstruct a
historical fixed tax reliably. No database/schema change is made by this package.

## Verification

Run `bun run --filter '@brightloop/shared' test`. It builds the package, checks valid and
invalid consumer examples under strict TypeScript (including exact optional
properties), verifies every Prisma enum, checks all backend endpoint cards and
domain error codes, and prevents imports of app-specific libraries. Root
`bun run test` includes these checks before the existing backend suite.

Run `bun run typecheck` and `bun run build` at the workspace root to check both
real consumers. No new packages, services, migrations or environment keys are
required. Rebuild shared after editing its declarations; the workspace dev script
already builds/watches it.
