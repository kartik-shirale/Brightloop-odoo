# Payment terms module (M2)

Base path `/api/v1/payment-terms`. Exposes `PaymentTermsGateway` for subscriptions and invoices:

```ts
interface PaymentTermRecord { id: number; name: string; dueDays: number; isDefault: boolean; isActive: boolean }
interface PaymentTermsGateway {
  getById(id: number): Promise<PaymentTermRecord | null>;
  getDefault(): Promise<PaymentTermRecord | null>; // the active default, or null
}
```

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List |
| GET | `/:id` | ADMIN, STAFF | |
| POST | `/` | ADMIN | `name`, `dueDays`, `isDefault` (default false), `isActive` (default true). Returns 201 with `Location` |
| PATCH | `/:id` | ADMIN | At least one field |
| DELETE | `/:id` | ADMIN | 409 `IN_USE` if referenced by a subscription or invoice, or if it is the default |

CUSTOMER and anonymous callers are refused (403 and 401). Roles are checked on the route and again in the service.

## List query

`search` (name, case-insensitive), `isActive`, `isDefault` (`true` or `false`), `sortBy` (`name`, `dueDays`, `createdAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the sort tie-breaker. Unknown keys return 400.

## Rules

- `name` is unique: 409 `DUPLICATE`.
- `dueDays` is an integer from 0 to 365.
- At most one default. Creating or patching with `isDefault=true` clears the previous default in the same repository transaction. The first term is not made default automatically; subscriptions without a term use `getDefault()`.
- The default must be active: `isDefault=true` with `isActive=false` (also after merging with the stored row) returns 400 on `isActive`. To deactivate the default, first make another term the default or send `isDefault=false`.
- The default term cannot be deleted (409 `IN_USE`). The delete is conditional on `isDefault = false`, and a referenced term fails on the foreign key (23503), so there is no read-then-delete race. Prefer `isActive=false`.
- Create, update and delete write audit entries (`payment-term.create`, `payment-term.update` with changes and previous values, `payment-term.delete`).

## Example

```
POST /api/v1/payment-terms
{ "name": "Net 15", "dueDays": 15, "isDefault": true }
```

```json
{ "success": true, "message": "Payment term created.",
  "data": { "id": 1, "name": "Net 15", "dueDays": 15, "isDefault": true, "isActive": true,
            "createdAt": "2026-10-31T09:00:00.000Z", "updatedAt": "2026-10-31T09:00:00.000Z" } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `DUPLICATE` (409), `IN_USE` (409).
