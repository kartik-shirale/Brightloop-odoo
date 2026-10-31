# Taxes module (M1)

Base path `/api/v1/taxes`. Exposes `TaxesGateway.getByIds(ids)` for subscriptions and invoices.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List |
| GET | `/:id` | ADMIN, STAFF | |
| POST | `/` | ADMIN | `name`, `type`, `rate`, `isActive` (default true). Returns 201 with `Location` |
| PATCH | `/:id` | ADMIN | At least one field |
| DELETE | `/:id` | ADMIN | 409 `IN_USE` if any subscription or invoice line references it. Prefer `isActive=false` |

CUSTOMER and anonymous callers are refused (403 and 401). Roles are checked on the route and again in the service.

## List query

`search` (name, case-insensitive), `type` (`PERCENTAGE,FIXED`), `isActive` (`true` or `false`), `sortBy` (`name`, `rate`, `createdAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the sort tie-breaker. Unknown keys return 400.

## Rules

- `name` is unique: 409 `DUPLICATE`.
- PERCENTAGE `rate` is basis points, 0 to 10000. FIXED `rate` is paise per unit, 0 or more. Integers only. On PATCH the merged type and rate are validated together.
- Editing or deactivating a tax never changes existing lines, because lines hold a snapshot of the rate.
- Delete relies on the foreign keys, so there is no read-then-delete race.
- Create, update and delete write audit entries (`tax.create`, `tax.update` with changes and previous values, `tax.delete`).

## Example

```
POST /api/v1/taxes
{ "name": "GST 18%", "type": "PERCENTAGE", "rate": 1800 }
```

```json
{ "success": true, "message": "Tax created.",
  "data": { "id": 1, "name": "GST 18%", "type": "PERCENTAGE", "rate": 1800, "isActive": true,
            "createdAt": "2026-10-31T09:00:00.000Z", "updatedAt": "2026-10-31T09:00:00.000Z" } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `DUPLICATE` (409), `IN_USE` (409).
