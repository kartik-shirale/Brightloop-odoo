# Plans module (M6)

Base path `/api/v1/plans`. Exposes `PlansGateway` (`getById`, `assertAvailable`) for templates and subscriptions.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List |
| GET | `/:id` | ADMIN, STAFF | Includes `activeSubscriptionCount` (ACTIVE, not deleted) |
| POST | `/` | ADMIN | Returns 201 with `Location`. `createdById` is the caller |
| PATCH | `/:id` | ADMIN | At least one field |
| DELETE | `/:id` | ADMIN | Soft delete. 409 `IN_USE` if non-closed subscriptions exist |

CUSTOMER and anonymous callers are refused (403 and 401). Roles are checked on the route and again in the service.

## List query

`search` (name and description, case-insensitive), `billingPeriod` (`DAILY,WEEKLY,MONTHLY,YEARLY`), `isActive`, `autoClose`, `closable`, `pausable`, `renewable` (`true` or `false`), `availableOn` (`YYYY-MM-DD`: plans whose window covers that day, both ends inclusive, no end date means open-ended), `sortBy` (`name`, `price`, `availableFrom`, `createdAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the sort tie-breaker. Unknown keys return 400. Soft-deleted plans never appear.

## Rules

- `price` is integer paise, 0 or more. `minQuantity` is an integer, 1 or more (default 1).
- `availableFrom` and `availableTo` are date inputs normalized to UTC midnight. `availableTo` must be after `availableFrom` (400 on `availableTo`). On PATCH the merged window is validated.
- `billingPeriod` cannot change to a different value while non-closed subscriptions (status not CLOSED, not deleted) use the plan: 409 `IN_USE`.
- Flag changes (`autoClose`, `closable`, `pausable`, `renewable`, `isActive`) apply immediately to existing subscriptions.
- Delete is blocked the same way (409 `IN_USE`). Deactivate with `isActive=false` instead.
- The open-subscription check and the write are separate statements, so a subscription created in between is not caught (no cross-module transaction).
- Audit entries: `plan.create`, `plan.update` (changes and previous values), `plan.delete`.

## Gateway

- `getById(id)`: plan record or `null` (missing or soft-deleted).
- `assertAvailable(id, date)`: returns the record. Missing or deleted plan: 404. Inactive plan, or `date` before the `availableFrom` day or after the `availableTo` day (UTC calendar day, inclusive): 409 `PLAN_NOT_AVAILABLE`.

## Example

```
POST /api/v1/plans
{ "name": "Pro yearly", "price": 99900, "billingPeriod": "YEARLY", "availableFrom": "2026-11-01", "closable": true }
```

```json
{ "success": true, "message": "Plan created.",
  "data": { "id": 1, "name": "Pro yearly", "description": null, "price": 99900, "billingPeriod": "YEARLY",
            "minQuantity": 1, "availableFrom": "2026-11-01T00:00:00Z", "availableTo": null,
            "autoClose": false, "closable": true, "pausable": false, "renewable": false, "isActive": true,
            "createdById": 1, "createdAt": "2026-10-31T09:00:00Z", "updatedAt": "2026-10-31T09:00:00Z",
            "activeSubscriptionCount": 0 } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `IN_USE` (409), `PLAN_NOT_AVAILABLE` (409, gateway only).
