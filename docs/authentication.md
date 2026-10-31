# Authentication API

All paths below start with `/api/v1`. The frontend can import DTOs, `Role`, and
`API_ROUTES` from `@brightloop/shared`. Public signup creates CUSTOMER accounts only. ADMIN
is seeded from environment settings; STAFF is provisioned administratively.

## Routes and role access

| Method and path | Access | Example input | Success response data |
| --- | --- | --- | --- |
| POST `/auth/register` | Public | `{"name":"Alice","email":"alice@example.com","password":"Password123","confirmPassword":"Password123"}` | 201: `{"email":"alice@example.com","expiresInSeconds":300}` |
| POST `/auth/verify-otp` | Public | `{"email":"alice@example.com","otp":"123456"}` | 200: AuthResult below; sets refresh cookie |
| POST `/auth/resend-otp` | Public | `{"email":"alice@example.com"}` | 200: `{"expiresInSeconds":300}` |
| POST `/auth/login` | Public | `{"email":"alice@example.com","password":"Password123"}` | 200: AuthResult; sets refresh cookie |
| POST `/auth/refresh` | Refresh cookie or token | No body or `{}` with cookie | 200: AuthResult; rotates refresh cookie |
| POST `/auth/logout` | Refresh cookie or token | No body or `{}` with cookie | 200: success message; clears cookie |
| POST `/auth/forgot-password` | Public | `{"email":"alice@example.com"}` | 200: `{"expiresInSeconds":300}` |
| POST `/auth/verify-reset-otp` | Public | `{"email":"alice@example.com","otp":"123456"}` | 200: `{"resetToken":"<96 hex characters>","expiresInSeconds":300}` |
| POST `/auth/reset-password` | Public | `{"email":"alice@example.com","otp":"123456","password":"NewPass123","confirmPassword":"NewPass123"}` | 200: success message; clears cookie |
| GET `/auth/sessions?page=1&limit=10` | CUSTOMER, STAFF, ADMIN | Query only | 200: SessionDto array plus pagination metadata |
| DELETE `/auth/sessions/7` | Session owner | Integer ID | 200: success message |
| POST `/auth/logout-all` | CUSTOMER, STAFF, ADMIN | No body | 200: success message; clears cookie |
| GET `/users?page=1&limit=10` | ADMIN, STAFF | Optional search, sortBy, order, role, verified, createdFrom, createdTo | 200: UserDto array plus pagination metadata |
| GET `/users/stats` | ADMIN, STAFF | No body | 200: `{"total":10,"verified":8,"unverified":2,"admins":1}` |
| GET `/users/me` | CUSTOMER, STAFF, ADMIN | No body | 200: UserDto |
| PATCH `/users/me` | CUSTOMER, STAFF, ADMIN | `{"name":"Alice Updated","username":"alice"}` | 200: updated UserDto |
| POST `/users/me/password` | CUSTOMER, STAFF, ADMIN | `{"currentPassword":"Password123","password":"NewPass123","confirmPassword":"NewPass123"}` | 200: success message; revokes other devices |
| GET `/users/42` | Self, ADMIN, STAFF | Integer ID | 200: UserDto |

## Response examples

Every API success wraps its data in an envelope. For example:

```json
{"success":true,"message":"Account created. A 6-digit code was sent to alice@example.com.","data":{"email":"alice@example.com","expiresInSeconds":300}}
```

AuthResult, returned by verification/login/refresh, has this shape:

```json
{
  "success": true,
  "message": "Signed in.",
  "data": {
    "user": {
      "id": 42, "name": "Alice", "username": null, "email": "alice@example.com",
      "role": "CUSTOMER", "emailVerifiedAt": "2026-10-31T00:00:00Z",
      "passwordChangedAt": null, "lastLoginAt": "2026-10-31T00:00:00Z",
      "createdAt": "2026-10-31T00:00:00Z", "updatedAt": "2026-10-31T00:00:00Z"
    },
    "accessToken": "<signed JWT>", "accessTokenExpiresIn": 900,
    "refreshExpiresAt": "2026-11-30T00:00:00Z"
  }
}
```

User profile endpoints return the `user` object above as their `data`. Lists return
an array as `data` and `meta` such as:

```json
{"page":1,"limit":10,"total":1,"totalPages":1,"hasNext":false,"hasPrev":false}
```

SessionDto example:

```json
{"id":7,"userAgent":"browser","ip":"127.0.0.1","expiresAt":"2026-11-30T00:00:00Z","revokedAt":null,"lastUsedAt":null,"createdAt":"2026-10-31T00:00:00Z","current":true}
```

Message-only success and validation failure:

```json
{"success":true,"message":"Signed out."}
```

```json
{"success":false,"message":"Validation failed","error":{"code":"VALIDATION_ERROR","details":[{"field":"email","message":"Invalid email address"}]}}
```

Validation returns 400, missing/expired/revoked authentication 401, forbidden role
access 403, duplicate email 409, rate limits 429 with `Retry-After`, dependency
failure 503. Refresh/logout optionally accept `{"refreshToken":"<96 hex characters>"}`
for non-browser clients. The HTTP response never returns refresh tokens in JSON.

## Browser flow

Use `credentials: 'include'` on auth requests and `Authorization: Bearer <accessToken>`
on protected requests. Keep the access token in application memory. The refresh
cookie is httpOnly, SameSite=Lax, scoped to `/api/v1/auth`, and Secure in production.
Serialize browser refresh attempts: one refresh token is accepted exactly once.
Use the returned role to choose the dashboard; the backend independently enforces
role access and session ownership.

OTP digests and wrong-attempt counts share a Redis record with a 300-second TTL.
Verification, attempt counting, and consumption execute atomically. Resend has a
60-second cooldown and 10-per-day per-purpose/email limit. Email and login/OTP
routes also have a 30-request/15-minute IP limit; the API global limit is 100.
Failed delivery removes the unusable code and releases its cooldown. Password
reset updates the password and revokes all sessions in one database transaction.
Password change preserves the current device and revokes the others. Every
protected request checks the issuing session, so logout/revocation is immediate.

## Configuration and database

See `apps/core/.env.example` for all settings. Supply your own DATABASE_URL,
JWT_ACCESS_SECRET, OTP_HMAC_SECRET, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY. ADMIN_EMAIL and ADMIN_PASSWORD are optional
but must be supplied together. JWT_REFRESH_SECRET is unnecessary because refresh
tokens are opaque random values, stored only as SHA-256 hashes in PostgreSQL.

Redis uses the `redis` service in `compose.yaml` at `redis://127.0.0.1:6380`.
The runtime requires Redis; it does not silently fall back to memory. The memory
store exists only as an injected test double. Missing credentials fail fast.

The initial `20261031T0007_auth_foundation` migration is generated and applied.
The database marker and live schema have been verified. Real admin login, cookie
rotation, reload restoration and logout pass browser tests against PostgreSQL and
Docker Redis. Automated signup and password-recovery tests mock email delivery;
no real test emails were sent. The browser password recovery flow exchanges an
OTP at `/auth/verify-reset-otp` for a five-minute, single-use reset token, then
submits it in place of `otp` to `/auth/reset-password`. The legacy combined OTP
reset request remains supported.

## Implementation files

- `compose.yaml`, root `package.json`: Redis lifecycle commands.
- `apps/core/package.json`, `tsconfig.build.json`, `.env.example`, `README.md`: scripts and setup.
- `apps/core/src/app.ts`, `server.ts`, `container.ts`: application wiring, readiness and shutdown.
- `apps/core/src/config/{env,redis,prisma}.ts`: validated configuration and shared clients.
- `apps/core/src/core/middlewares/{auth-barriers,validate,rate-limit,error-handler}.ts`: request protection and errors.
- `apps/core/src/core/{errors,logger}.ts`, `core/utils/tokens.ts`, `core/types/{express.d,db-rows}.ts`, `core/mail/emailjs.ts`: infrastructure and token helpers.
- `apps/core/src/modules/auth/{auth.routes,auth.schema,auth.service,auth.repository,otp.service}.ts`: authentication flow.
- `apps/core/src/modules/users/{users.routes,users.schema,users.service,users.repository}.ts`: profile, role gates and lists.
- `apps/core/src/prisma/{db,seed}.ts`: client initialization and optional admin seed.
- `shared/src/index.ts`, `shared/src/types/{auth,api,list-meta}.ts`: frontend contracts.
- Tests: `core/utils/{hash,tokens}.test.ts`, `modules/auth/{auth,otp.service}.test.ts`, `config/redis.integration.ts`, `core/test-env.ts` under `apps/core/src`.


## Brightloop compatibility update

See [compatibility baseline](plan/compatibility.md). The visible application is
Brightloop, roles are ADMIN/STAFF/CUSTOMER, public signup creates CUSTOMER, and
inactive accounts cannot authenticate. Customers land in the `/portal` shell;
admin/staff use `/dashboard`. No business module endpoints are added yet.
