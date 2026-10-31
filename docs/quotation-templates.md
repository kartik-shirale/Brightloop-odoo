# Quotation templates module (M8)

Base path `/api/v1/quotation-templates`. Exposes `TemplatesGateway` (`getWithLines`) for subscriptions. Depends on `CatalogGateway` (products) and `PlansGateway` (plans).

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List (no lines) |
| GET | `/:id` | ADMIN, STAFF | Includes `plan` and ordered `lines` with product and variant names |
| POST | `/` | ADMIN | Returns 201 with `Location`. `createdById` is the caller |
| PATCH | `/:id` | ADMIN | At least one field. `lines`, when sent, replaces all lines in one transaction |
| DELETE | `/:id` | ADMIN | Soft delete (`deletedAt`). Existing subscriptions are unaffected |

CUSTOMER and anonymous callers are refused (403 and 401). Roles are checked on the route and again in the service.

## List query

`search` (name and notes, case-insensitive), `planId`, `isActive` (`true` or `false`), `sortBy` (`name`, `validityDays`, `createdAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the sort tie-breaker. Unknown keys return 400. Soft-deleted templates never appear.

## Rules

- Body: `name` (1 to 150), `planId`, `validityDays` (integer 1 to 365), `notes` (optional, nullable), `isActive` (default true), `lines` (1 to 100).
- Line: `productId`, `variantId` (optional, nullable), `quantity` (integer, 1 or more), `sortOrder` (accepted but ignored: the stored order is the array index). Duplicate product lines are allowed.
- Every product and variant must exist, be active, and the variant must belong to the product (checked through `CatalogGateway.getPricedItem`). Failures are 400 `VALIDATION_ERROR` with `field` `lines.<index>.productId` or `lines.<index>.variantId`.
- The plan must exist and be active (`PlansGateway.getById`), otherwise 400 on `planId`. PATCH re-validates the plan only when `planId` changes, so an existing template can still be renamed after its plan was deactivated.
- PATCH with `lines` deletes and re-inserts all lines inside one repository transaction. A failure keeps the old lines and fields. The lines are validated first, so a bad line causes no write.
- Lines are returned ordered by `sortOrder`, then `id`.
- `DELETE` keeps the line rows. Names in the response (`planName`, `productName`, `variantLabel` as `Attribute: value`) are read from the plan, product and variant tables read-only, so deleted rows still resolve.
- Audit entries: `quotationTemplate.create`, `quotationTemplate.update` (changes, previous values, `linesReplaced`), `quotationTemplate.delete`.

## Gateway

```ts
interface TemplatesGateway {
  getWithLines(id: number): Promise<TemplateWithLines | null>;
}
// TemplateWithLines = { id, name, planId, validityDays, notes: string | null, isActive,
//   lines: { productId, variantId: number | null, quantity, sortOrder }[] }
```

Returns `null` when the template is missing or soft-deleted. Callers check `isActive`.

## Example

```
POST /api/v1/quotation-templates
{ "name": "Starter bundle", "planId": 1, "validityDays": 30,
  "lines": [{ "productId": 10, "variantId": 100, "quantity": 2 }, { "productId": 11, "quantity": 1 }] }
```

Response `data`: list-item fields (`id`, `name`, `planId`, `planName`, `validityDays`, `notes`, `isActive`, `createdById`, `createdAt`, `updatedAt`) plus `plan` (`id`, `name`, `billingPeriod`) and `lines` (`id`, `templateId`, `productId`, `productName`, `variantId`, `variantLabel`, `quantity`, `sortOrder`).

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `IN_USE` (409, a plan or product disappeared between validation and write).

## Notes

- Catalog and plan checks run before the write and are not in the same transaction as it.
- No contract change and no migration.
