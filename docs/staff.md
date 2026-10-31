# Staff module (M4)

Base path `/api/v1/staff`. Every route is ADMIN only; STAFF and CUSTOMER get 403, anonymous gets 401. Roles are checked on the route and again in the service. The module only sees users with role STAFF that are not soft-deleted: ADMIN, CUSTOMER, soft-deleted and unknown ids return 404.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN | List |
| GET | `/:id` | ADMIN | |
| POST | `/` | ADMIN | `name`, `email`, `username?`, `password`. Returns 201 with `Location` |
| PATCH | `/:id` | ADMIN | `name` and/or `username` (null clears it). At least one field |
| POST | `/:id/deactivate` | ADMIN | Returns the updated `StaffDto`. Idempotent (200 when already inactive) |
| POST | `/:id/activate` | ADMIN | Returns the updated `StaffDto`. Idempotent (200 when already active) |
| DELETE | `/:id` | ADMIN | Soft delete plus session revoke |

## List query

`search` (name, email, username; case-insensitive), `isActive` (`true` or `false`), `sortBy` (`name`, `email`, `createdAt`, `lastLoginAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the sort tie-breaker. Unknown keys (for example `role`) return 400.

## Rules

- The role is always STAFF. The body schema is strict, so `role` (or any other unknown key) is a 400.
- The admin sets the initial password. It follows the signup policy: 9+ characters, upper, lower and special character, at most 72 bytes. There is no forced password change.
- `emailVerifiedAt` is set at creation and the account is active, so the member can sign in right away. Emails are trimmed and lowercased.
- Email is unique across all users, including soft-deleted ones. Username is unique. Both return 409 `DUPLICATE`.
- Deactivate sets `isActive=false` and revokes every live session in one database transaction. The next request with any of that member's tokens returns 401, because authentication re-checks the live user and session. Deactivating an already inactive member still revokes sessions.
- Activating restores sign-in, but revoked sessions stay revoked: the member signs in again.
- Delete sets `deletedAt` (and `isActive=false`) and revokes sessions in one transaction. The email stays reserved.
- An admin cannot deactivate or delete their own account (403 `FORBIDDEN`).
- The password hash is never returned or audited.
- Audit actions: `staff.create`, `staff.update` (changes and previous values), `staff.deactivate`, `staff.activate`, `staff.delete`.

## Example

```
POST /api/v1/staff
{ "name": "Sam Rao", "email": "sam@brightloop.test", "username": "sam", "password": "Welcome#2026" }
```

```json
{ "success": true, "message": "Staff member created.",
  "data": { "id": 4, "name": "Sam Rao", "username": "sam", "email": "sam@brightloop.test", "role": "STAFF",
            "isActive": true, "emailVerifiedAt": "2026-10-31T09:00:00.000Z", "passwordChangedAt": null,
            "lastLoginAt": null, "createdAt": "2026-10-31T09:00:00.000Z", "updatedAt": "2026-10-31T09:00:00.000Z" } }
```

## Error codes

`VALIDATION_ERROR` (400), `AUTH_REQUIRED` and `SESSION_REVOKED` (401), `FORBIDDEN` (403, including self-deactivate and self-delete), `NOT_FOUND` (404), `DUPLICATE` (409).
