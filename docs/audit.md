# Audit module

Records who did what, and lets an admin read it back. Every mutating module writes an entry through `AuditGateway`.

## Gateway

```ts
record({ actor, action, entityType, entityId?, metadata?, ip? }): Promise<void>
```

- `actor` is the acting `Actor`, or `null` for system work (scheduled jobs).
- `action` is a dotted verb such as `invoice.confirm`. `entityType` is the model name.
- `record` never throws. A failed write is logged (action, entity, error) and the caller's operation still succeeds.
- Metadata is converted to plain JSON and any value under a key matching `pass(word)`, `token`, `secret`, `otp`, `authorization`, `cookie`, `hash`, `api key`, `private key` or `credential` is replaced with `[REDACTED]`, at any depth. Nesting beyond 8 levels is truncated.

## Endpoint

| Method | Path | Roles |
|---|---|---|
| GET | `/api/v1/audit-logs` | ADMIN |

STAFF and CUSTOMER receive 403, a missing token receives 401. The service re-checks the role.

### Query

| Param | Rule |
|---|---|
| `page`, `limit` | `page` at least 1 (default 1). `limit` 1 to 100 (default 10) |
| `search` | 1 to 100 chars, case-insensitive match on `action` |
| `sortBy` | `createdAt` only. `sortOrder` `asc` or `desc` (default `desc`). `id` is the tie-breaker |
| `userId`, `entityId` | Positive integers |
| `action`, `entityType` | Exact match, 1 to 100 chars |
| `createdFrom`, `createdTo` | ISO 8601, inclusive. A date-only `createdTo` means the end of that UTC day |

Unknown keys return 400 `VALIDATION_ERROR`.

### Example

```
GET /api/v1/audit-logs?action=invoice.confirm&createdFrom=2026-10-01&limit=2
Authorization: Bearer <admin access token>
```

```json
{
  "success": true,
  "message": "Audit logs fetched.",
  "data": [
    {
      "id": 41,
      "userId": 1,
      "userName": "Ada Admin",
      "action": "invoice.confirm",
      "entityType": "Invoice",
      "entityId": 7,
      "metadata": { "number": "INV-2026-000007" },
      "ip": "203.0.113.5",
      "createdAt": "2026-10-31T09:30:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 2, "total": 1, "totalPages": 1, "hasNext": false, "hasPrev": false }
}
```

`userName` is resolved with one batched query per page. It is `null` for system entries.

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403).
