# Products and variants module (M3)

Base path `/api/v1/products`. Exposes `CatalogGateway.getPricedItem(productId, variantId?)` for subscriptions and quotation templates.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List. `include=variants` |
| POST | `/` | ADMIN | Optional `variants[]` created in the same transaction. 201 with `Location` |
| GET | `/:id` | ADMIN, STAFF | With variants |
| PATCH | `/:id` | ADMIN | At least one field |
| DELETE | `/:id` | ADMIN | Soft delete (`deletedAt`) |
| GET | `/:productId/variants` | ADMIN, STAFF | List |
| POST | `/:productId/variants` | ADMIN | `attribute`, `value`, `extraPrice` (default 0), `isActive` (default true) |
| PATCH | `/:productId/variants/:variantId` | ADMIN | At least one field |
| DELETE | `/:productId/variants/:variantId` | ADMIN | Hard delete. 409 `IN_USE` if a line references it. Prefer `isActive=false` |

CUSTOMER and anonymous callers are refused (403 and 401). Roles are checked on the route and again in the service.

## Access shape

ADMIN receives `ProductAdminDto` (with `costPrice`). STAFF receives `ProductDto` without `costPrice`. The shape is chosen in the service from the actor's role. Single-product reads and create return the detail shape with `variants`.

## List queries

Products: `search` (name and notes), `type` (comma list of `SERVICE,SOFTWARE,ADDON,PHYSICAL`), `isActive`, `minPrice` / `maxPrice` (paise, on `salesPrice`), `include=variants`, `sortBy` (`name`, `salesPrice`, `createdAt`, default `createdAt`).

Variants: `search` (attribute and value), `isActive`, `sortBy` (`attribute`, `value`, `extraPrice`, default `attribute`).

Both: `sortOrder` (default `desc`), `page`, `limit` (1 to 100), `id` tie-breaker, unknown keys return 400. `include=variants` loads variants for the page with one extra query.

## Rules

- Prices are integer paise, 0 or more. Variant unique on (product, attribute, value): 409 `DUPLICATE`. Duplicate pairs inside one create body are a 400.
- Soft-deleted products are excluded from every read and list. Their variants are unreachable (404 on every variant route).
- `createdById` is the creating actor.
- Variant delete relies on the foreign keys (23503), so there is no read-then-delete race.
- Audit actions: `product.create`, `product.update` (changes and previous), `product.delete`, `product.variant.create`, `product.variant.update`, `product.variant.delete`.

## CatalogGateway

`getPricedItem(productId, variantId?)` returns `{ productId, variantId, name, unitPrice, isActive }`.
`name` is `Product` or `Product (Attribute: Value)`. `unitPrice = salesPrice + extraPrice`. `isActive` is false when the product or variant is inactive; callers must refuse inactive items on new lines. 404 when the product is missing or soft-deleted, and 404 when the variant does not exist or belongs to another product.

## Example

```
POST /api/v1/products
{ "name": "Odoo ERP", "type": "SOFTWARE", "salesPrice": 100000, "costPrice": 40000,
  "variants": [{ "attribute": "Brand", "value": "Odoo", "extraPrice": 56000 }] }
```

```json
{ "success": true, "message": "Product created.",
  "data": { "id": 1, "name": "Odoo ERP", "type": "SOFTWARE", "salesPrice": 100000, "costPrice": 40000,
            "notes": null, "isActive": true, "createdById": 1,
            "createdAt": "2026-10-31T09:00:00.000Z", "updatedAt": "2026-10-31T09:00:00.000Z",
            "variants": [{ "id": 1, "productId": 1, "attribute": "Brand", "value": "Odoo", "extraPrice": 56000,
                           "isActive": true, "createdAt": "2026-10-31T09:00:00.000Z", "updatedAt": "2026-10-31T09:00:00.000Z" }] } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `DUPLICATE` (409), `IN_USE` (409).
