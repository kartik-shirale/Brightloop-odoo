# Discounts module (M7)

Base path `/api/v1/discounts`. Exposes `DiscountsGateway` (`evaluate`, `listAttachedForSubscription`) for invoices and subscriptions.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List |
| GET | `/:id` | ADMIN, STAFF | Includes `productIds` and `attachedSubscriptionCount` |
| POST | `/` | ADMIN | Returns 201 with `Location`. `createdById` is the caller. `productIds[]` only for scope PRODUCT |
| PATCH | `/:id` | ADMIN | At least one field. `usedCount` is rejected (strict schema) |
| DELETE | `/:id` | ADMIN | Soft delete. Usage history is kept |
| PUT | `/:id/products` | ADMIN | Replaces the product set in one transaction. Scope PRODUCT only (409 otherwise). Products must exist and not be deleted (400) |
| POST | `/:id/subscriptions` | ADMIN, STAFF | Body `subscriptionIds[]`. Scope SUBSCRIPTION only. Already attached ids are kept. Subscriptions must exist and not be deleted (404) |
| DELETE | `/:id/subscriptions/:subscriptionId` | ADMIN, STAFF | Detach. 404 if not attached |
| GET | `/:id/usages` | ADMIN, STAFF | Usage list |

CUSTOMER and anonymous callers are refused (403 and 401). Roles are checked on the route and again in the service. STAFF may attach and detach (decision made by the product owner); only ADMIN edits rules.

## List queries

Discounts: `search` (name and code, case-insensitive), `type`, `scope`, `state` (comma lists), `isActive`, `productId`, `sortBy` (`name`, `startDate`, `endDate`, `usedCount`, `createdAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the tie-breaker. Unknown keys return 400. Soft-deleted discounts never appear.

`state` is derived at query time from the business date (`APP_TIMEZONE`), the dates and `usedCount`, with this precedence: `upcoming` (startDate after today), `expired` (endDate before today), `exhausted` (`usedCount >= usageLimit`), otherwise `active`. `isActive=false` is separate from state.

Usages: `invoiceId`, `subscriptionId`, `createdFrom`, `createdTo` (date-only `createdTo` means end of day), `sortBy` (`createdAt`, `amount`), `sortOrder`, `page`, `limit`. No `search`.

## Rules

- `type` PERCENTAGE: `value` 1 to 10000 basis points. FIXED: `value` at least 1 paise. All money is integer paise.
- `startDate` and `endDate` are normalized to UTC midnight. `endDate` is on or after `startDate` (400 on `endDate`); on PATCH the merged window is validated. `endDate` is inclusive by calendar day, null means open-ended.
- `usageLimit` at least 1, or null for unlimited. `minPurchase` at least 0 paise or null. `minQuantity` at least 1 or null.
- `code` is optional and unique (409 `DUPLICATE`).
- `scope` cannot change once usages exist (409 `IN_USE`). Changing it otherwise empties the link table of the scope being left (products or attached subscriptions).
- Attaching an inactive, expired or exhausted discount, or a PRODUCT-scope discount, returns 409 `DISCOUNT_NOT_APPLICABLE`. An upcoming discount can be attached.
- This module never writes `usedCount` or `DiscountUsage`: the invoices module does that in its own transaction.
- Audit entries: `discount.create`, `discount.update` (changes and previous values), `discount.delete`, `discount.products.set`, `discount.attach`, `discount.detach`.

## Evaluation (`DiscountsGateway.evaluate`)

Input `{ subscriptionId | null, lines: [{ lineId, productId | null, quantity, amount }], asOf }`. Output `[{ discountId, lineId, amount }]`. Pure read: no writes, no `usedCount` change.

A discount is eligible when it is active, not deleted, `startDate <= asOf <= endDate` by UTC calendar day (both inclusive), and `usedCount < usageLimit` (null = unlimited).

1. PRODUCT scope, ascending discount id. Each line whose `productId` is in the discount's product set is its own application: its quantity must reach `minQuantity`, and its remaining amount (after earlier discounts) must reach `minPurchase`. PERCENTAGE is `bpsOf(base, value)`, FIXED is `value` per matched line, never more than the base.
2. SUBSCRIPTION scope (skipped when `subscriptionId` is null), ascending discount id, only discounts attached to the subscription. Base is the sum of the remaining amounts after all product discounts and earlier subscription discounts; quantity is the total quantity. The discount amount is split over the lines in proportion to their remaining amounts (`allocateProportionally`, last line absorbs the remainder), so the per-line amounts sum to the discount. A line never receives more than it has left: overflow moves to earlier lines.
3. Applications with amount 0 are omitted. `lineId` is echoed back untouched.

`listAttachedForSubscription(subscriptionId)` returns `{ id, name, code, type, value, scope }` for non-deleted attached discounts.

## Example

```
POST /api/v1/discounts
{ "name": "Spring 15%", "code": "SPRING", "type": "PERCENTAGE", "value": 1500, "scope": "PRODUCT",
  "startDate": "2026-11-01", "endDate": "2026-12-31", "usageLimit": 100, "productIds": [1, 2] }
```

```json
{ "success": true, "message": "Discount created.",
  "data": { "id": 1, "name": "Spring 15%", "code": "SPRING", "type": "PERCENTAGE", "value": 1500, "scope": "PRODUCT",
            "minPurchase": null, "minQuantity": null, "startDate": "2026-11-01T00:00:00Z", "endDate": "2026-12-31T00:00:00Z",
            "usageLimit": 100, "usedCount": 0, "state": "upcoming", "isActive": true, "createdById": 1,
            "createdAt": "2026-10-31T09:00:00Z", "updatedAt": "2026-10-31T09:00:00Z",
            "productIds": [1, 2], "attachedSubscriptionCount": 0 } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `DUPLICATE` (409, code), `IN_USE` (409, scope change after use), `DISCOUNT_NOT_APPLICABLE` (409, attach), `CONFLICT` (409, product set on a SUBSCRIPTION-scope discount).

## Not implemented

`GET /discounts/:id/subscriptions` (frontend-proposed, in `ProposedApiContracts` only) is not part of this card and is not built.
