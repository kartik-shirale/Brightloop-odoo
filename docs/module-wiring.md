# Module wiring

Feature modules plug into the app through three shared files. Each module edits only its own labelled block, so modules can be built in any order without merge conflicts (backend plan section 5). On a conflict, keep both sides.

## `apps/core/src/container.ts`

One labelled block per module in each of four regions. Fill your own block and nothing else:

| Region | What goes in your block |
|---|---|
| `module imports: <name>` | Imports of your repository and service |
| `module services: <name>` | `readonly <name>Service: <Name>Service;` on `AppServices`. Add a gateway field only if other modules consume it |
| `module wiring: <name>` | Construct the repository and service. Pass other modules' gateways to the constructor. Never import another module's repository |
| `module services return: <name>` | The shorthand property in the returned object |

Wiring blocks run top to bottom, in dependency order, so a block can use anything defined above it:

audit, sequences, taxes, payment-terms, products, staff, customers, plans, discounts, quotation-templates, subscriptions, invoices, payments, billing-runs, portal, reports.

A module that needs a gateway from a block further down needs that block moved up. Raise it with the foundation owner instead of reordering silently.

## `apps/core/src/app.ts`

One mount line per module between `module mounts` and `end module mounts`. The line is already written and commented. The owner uncomments it once the router exists and imports the router factory.

- Every router calls `router.use(authenticate(authService))` itself and applies `requireRoles` per route.
- The portal module owns the `/portal` and `/me` prefixes and mounts them separately. Never mount it at `/`, because its authentication would intercept unmatched paths.
- Static routes (`/from-template`, `/generate`, `/summary`, `/preview`) are registered before `/:id` inside each router.

## `shared/src/types/index.ts`

Already exports one line per feature. Shared types are owned by the module and only edited additively after merge.

## Not a module block

The scheduler (`core/jobs/scheduler.ts`) is started from `server.ts`, not from `container.ts`. It is added with the scheduled-jobs task.
