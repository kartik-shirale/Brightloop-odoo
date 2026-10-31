# Brightloop compatibility baseline

This change aligns the existing authentication application with `ps.md`,
`frontend.md`, `backend.md`, and the user-authored Prisma contract. It does not
implement the planned subscription, billing, catalog, staff administration,
customer management, reporting, or audit modules.

## Existing application changes

- Visible application name: Brightloop; description: Subscription Management.
  Shared app constants drive auth and dashboard branding; HTML metadata is updated.
  The shared package is `@brightloop/shared`; app packages remain `@odoo/core`
  and `@odoo/web`. Existing cookie names are retained so refresh
  sessions continue to work.
- Roles come from `shared/src/types/enums.ts`: ADMIN, STAFF, CUSTOMER. Public signup
  always creates CUSTOMER, never a staff/admin role from client input.
- The shared UserDto includes isActive. Login, JWT-backed requests, refresh and
  recovery reject inactive accounts. Deactivation does not require a password change.
- ADMIN and STAFF land at `/dashboard`; CUSTOMER lands at `/portal`. Root routing,
  authenticated auth-page redirects, login, email verification and cross-role guards
  use the same home-route helper. The portal is an account/empty-state shell only.
- Existing `/users/me` and password/session management remain available to all
  authenticated roles. User list and stats are ADMIN/STAFF only. Foreign customer
  profile requests return 404. No staff-provisioning endpoint is introduced here.
- New and changed passwords follow the problem statement: at least 9 characters,
  uppercase, lowercase, a special character, and at most 72 UTF-8 bytes for bcrypt.
  Existing login credentials/hashes are retained. Existing admin seeds are not
  overwritten; new admin seed passwords must satisfy the creation policy.
- The existing OTP and refresh-cookie flow is preserved. Password-reset link
  features and Customer get-or-create behavior remain for their planned owners.

## Database compatibility

Generated contract artifacts reflect the full schema authored by the user.
Migration package: `apps/core/migrations/app/20261031T0447_brightloop_compatibility`.
It maps USER to CUSTOMER and MANAGER to STAFF, retains ADMIN, and adds isActive
with a true default for existing accounts. It synchronizes the remaining tables
from the authored contract, without implementing their business logic or APIs.
The removed scaffold Post table was checked and contained zero rows before
migration; it is the only table removed by the migration.

Account IDs, email addresses, password hashes, and session rows are compared
before/after migration without logging their values. The initial migration and
its snapshots are retained unchanged.

Migration application and live verification are recorded in the completion note
below. No database reset, password rotation, or new sample business records are
part of this change.

## Validation

- Workspace typecheck and production build.
- Auth regression tests, including CUSTOMER signup, STAFF/ADMIN gates, inactive
  account rejection, strong new-password validation and legacy credential login.
- `bun run test:compatibility` in `apps/web`: production-artifact browser tests
  for all three roles and cross-role routing. Artifacts and API replies are
  intercepted in the browser, so no dev server or real email delivery is needed.
- Existing live-server E2E cases are updated to expect customer portal routing.
  They require the user to start the services and are not started automatically.

## Main files

- `shared/src/app.ts`, `shared/src/types/enums.ts`, `shared/src/types/auth.ts`, `shared/src/index.ts`.
- `apps/core/src/core/types/db-rows.ts`, `core/utils/tokens.ts`, `core/mail/emailjs.ts`.
- Auth/users schemas, services, repositories, route gates and DTO mappers; admin seed.
- Generated Prisma contract artifacts and the compatibility migration/snapshot.
- `apps/web/src/constants/{app,roles,routes,navigation}.ts`.
- Auth redirects, HomeRedirect, RoleGuard, AuthLayout, DashboardLayout, PortalLayout,
  the portal landing page, new-password validation/copy, and HTML metadata.
- Auth/role tests, `apps/web/e2e/compatibility.spec.ts`, and the matching package script.
- Existing frontend/backend engineering rules and authentication documentation.

## Completion note

Database application and verification: complete. The compatibility migration was
applied and `prisma db verify` confirmed the marker and live schema match the
regenerated contract. Before/after checks confirmed account credentials and
all existing session rows were preserved, with the intended role mapping.

Validation passed: workspace typecheck, production build, 24 backend tests,
and 3 production-artifact browser compatibility checks (ADMIN, STAFF, CUSTOMER).
Lint reports no errors; the existing 18 shadcn Fast Refresh warnings remain.
No dev servers were started. No real emails were sent. No new packages were added.
