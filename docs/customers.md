# Customers module (M5)

Base path `/api/v1/customers`. Exposes `CustomersGateway` (`getById`, `getOrCreateForUser`, `snapshot`) for subscriptions, invoices, payments and the portal.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List. `include=summary` adds the summary to each row |
| GET | `/:id` | ADMIN, STAFF | Always includes `summary` |
| POST | `/` | ADMIN, STAFF | `name`, `email` required. Returns 201 with `Location` |
| PATCH | `/:id` | ADMIN, STAFF | At least one field. `null` clears an optional field |
| DELETE | `/:id` | ADMIN | Soft delete. 409 `IN_USE` if blocked |

CUSTOMER and anonymous callers are refused (403 and 401). Roles are checked on the route and again in the service.

## List query

`search` (name, companyName, email, phone, taxId, case-insensitive; `%` and `_` are literal), `hasPortalAccount` (`true`/`false`, userId set), `hasOutstanding` (`true`/`false`, a CONFIRMED invoice with `amountDue > 0` exists), `city`, `state` (case-insensitive exact), `createdFrom`, `createdTo` (ISO date or date-time, inclusive), `include=summary`, `sortBy` (`name`, `companyName`, `createdAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the sort tie-breaker. Unknown keys return 400.

## Summary

`{ activeSubscriptions, outstandingAmount (paise), overdueCount }`. Computed for the whole page with 3 grouped queries (active subscriptions, outstanding invoices, overdue invoices), never one query per row. Overdue means CONFIRMED, `amountDue > 0` and `dueDate` before now.

## Rules

- `userId` is never accepted from the body (strict schema, 400). `email` is trimmed and lower-cased.
- On create, a non-deleted CUSTOMER `User` with the same email (case-insensitive) that has no customer yet is linked (`userId` set).
- Delete is blocked (409 `IN_USE`) while the customer has ACTIVE or PAUSED subscriptions, or CONFIRMED invoices with `amountDue > 0`. Deleted customers disappear from lists, reads and the gateway. The check and the delete are not one transaction (a subscription activated in between is possible; subscription creation rejects deleted customers).
- Create, update (changes and previous values) and delete write audit entries: `customer.create`, `customer.update`, `customer.delete`.

## Gateway

- `getById(id)`: `CustomerRecord | null`, soft-deleted gives null.
- `getOrCreateForUser(userId)`: returns the customer linked to the user. Otherwise links the oldest unlinked customer with the same email (case-insensitive), otherwise creates one from the user's name and email. Race-safe: the unique `userId` constraint decides, a unique violation re-reads the winner. 404 unknown user, 403 for non-CUSTOMER users or a deleted customer. Audit: `customer.create` or `customer.link` (source `portal`).
- `snapshot(id)`: `{ name, email, taxId, billingAddress }`. `billingAddress` joins the non-empty address fields with `, ` (line1, line2, city, state, postalCode, country) and is `null` when none is set. 404 when missing.

## Example

```
GET /api/v1/customers?include=summary&hasOutstanding=true&limit=1
```

```json
{ "success": true, "message": "Customers fetched.",
  "data": [{ "id": 4, "userId": null, "name": "Acme", "companyName": "Acme Ltd", "email": "billing@acme.com",
             "phone": null, "taxId": null, "addressLine1": null, "addressLine2": null, "city": "Pune",
             "state": null, "postalCode": null, "country": null, "notes": null,
             "createdAt": "2026-10-31T09:00:00.000Z", "updatedAt": "2026-10-31T09:00:00.000Z",
             "summary": { "activeSubscriptions": 2, "outstandingAmount": 125000, "overdueCount": 1 } }],
  "meta": { "page": 1, "limit": 1, "total": 1, "totalPages": 1, "hasNext": false, "hasPrev": false } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `DUPLICATE` (409, two requests linking one user), `IN_USE` (409).
