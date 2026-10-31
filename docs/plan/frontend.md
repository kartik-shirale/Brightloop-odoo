# Brightloop Subscription Management: Frontend Build Plan

*Scope: frontend only. Authentication (signup, login, forgot and reset password, refresh, session check) is finished on both sides and is not planned here, except two small touchpoints listed in section 2. Stack: React, TypeScript strict, shadcn/ui, Zod, Axios, React Router, Bun. Legend: **A** = ADMIN, **S** = STAFF, **C** = CUSTOMER. Companion documents: the Backend Build Plan, the Frontend Engineering Rules, and the `shared/src/types` package delivered with this plan.*

## 1. What the frontend knows about the backend

The frontend knows exactly two things: the endpoint list in the Backend Build Plan, and the types in the shared package. It does not know Prisma, the schema, or any business rule that a DTO does not carry. This is what keeps the two teams from colliding.

1. **Types come from the shared package only.** Every request, response, query and enum is imported with `import type { ... } from '@shared/types'` (use the alias your repo already has; the backend plan calls it `@brightloop/shared`). The frontend never redefines, wraps or adapts a backend type. If a field is missing, ask the owner of `shared/src/types/<feature>.ts` for an additive change.
2. **The delivered type files are the starting contract.** They were derived from the schema and the backend plan (sections 1 to 3.5 and cards M1 to M14), and they typecheck under strict mode. The backend owner of each module takes over its file. After merge they change additively only.
3. **Frontend-only types** (`ListResult<T>`, table column definitions, UI state) live in `src/types/`.
4. **Form values are not request types.** A form schema may hold display-friendly values (rupees, percent). The submit hook maps them through a function such as `toCreateTaxRequest(values): CreateTaxRequest`, so the object that leaves the app is always the shared request type.
5. **Send only the fields in the type.** The backend uses strict Zod, so an unknown key returns 400.

### Wire conventions the frontend must follow

| Topic | Rule |
| --- | --- |
| Envelope | Success: `ApiSuccess<T>` or `ApiListSuccess<T>` (with `meta`). Failure: `ApiFailure` with `error.code` and `error.details[]`. API functions return `data` (and `meta` for lists), never the Axios response. |
| Money | Integer paise (`Paise`). Never use floats. `MoneyInput` converts a rupee string to paise by string math. Display only through `formatPaise`. Example: Odoo brand extra price shows as ₹560.00 and is sent as `56000`. |
| Rates | Integer basis points (`BasisPoints`). `PercentInput` converts `18` or `0.5` to `1800` or `50`. A FIXED tax or discount is paise, so its input switches to `MoneyInput`. |
| Dates | `IsoDateTime` strings. Date-only fields (start, expiry, due, payment, run, filters) are sent as `YYYY-MM-DD` and displayed in UTC so the day never shifts. Business today is `Asia/Kolkata`. |
| List queries | `page`, `limit` (1 to 100, default 10), `search`, `sortBy`, `sortOrder`. Enum filters are arrays in the types and `serializeQuery` joins them with commas. Booleans are sent as `true` or `false`. Undefined and empty values are dropped. |
| Update requests | Omitting a field means unchanged. `null` clears a nullable field. |
| Role-shaped types | Staff and admin shapes differ (`ProductDto` and `ProductAdminDto`), and the portal has its own DTOs (`Portal*Dto`). Use the type the endpoint returns for that role. |
| Not found | Another customer's record returns 404, never 403. Render the same NotFound state. |

### Type map

| Feature | File | Main exports |
| --- | --- | --- |
| Base | `common.ts`, `enums.ts`, `error-codes.ts` | `ApiSuccess`, `ApiListSuccess`, `ApiFailure`, `PaginationMeta`, `ListQuery`, `DateRange`, `Paise`, `BasisPoints`, `IsoDateTime`, every enum as an `as const` object plus union, `DOMAIN_ERROR_CODES` |
| Taxes | `taxes.ts` | `TaxDto`, `CreateTaxRequest`, `UpdateTaxRequest`, `ListTaxesQuery` |
| Payment terms | `payment-terms.ts` | `PaymentTermDto`, `CreatePaymentTermRequest`, `UpdatePaymentTermRequest`, `ListPaymentTermsQuery` |
| Products | `products.ts` | `ProductDto`, `ProductAdminDto`, `ProductVariantDto`, `CreateProductRequest`, `UpdateProductRequest`, `CreateVariantRequest`, `UpdateVariantRequest`, `ListProductsQuery`, `ListVariantsQuery` |
| Plans | `plans.ts` | `PlanDto`, `PlanRefDto`, `CreatePlanRequest`, `UpdatePlanRequest`, `ListPlansQuery` |
| Templates | `quotation-templates.ts` | `QuotationTemplateDto`, `QuotationTemplateListItemDto`, `QuotationTemplateLineDto`, `QuotationTemplateLineInput`, `Create/UpdateQuotationTemplateRequest`, `ListQuotationTemplatesQuery` |
| Discounts | `discounts.ts` | `DiscountDto`, `DiscountUsageDto`, `Create/UpdateDiscountRequest`, `SetDiscountProductsRequest`, `AttachDiscountSubscriptionsRequest`, `ListDiscountsQuery`, `ListDiscountUsagesQuery` |
| Staff | `staff.ts` | `StaffDto`, `CreateStaffRequest`, `UpdateStaffRequest`, `ListStaffQuery` |
| Customers | `customers.ts` | `CustomerDto`, `CustomerListItemDto`, `CustomerSummaryDto`, `CustomerRefDto`, `Create/UpdateCustomerRequest`, `ListCustomersQuery` |
| Subscriptions | `subscriptions.ts` | `SubscriptionDto`, `SubscriptionListItemDto`, `SubscriptionLineDto`, `SubscriptionStatusHistoryDto`, `SubscriptionLineInput`, `CreateSubscriptionRequest`, `CreateSubscriptionFromTemplateRequest`, `UpdateSubscriptionRequest`, `CloseSubscriptionRequest`, `RenewSubscriptionRequest`, `ListSubscriptionsQuery` |
| Invoices | `invoices.ts` | `InvoiceDto`, `InvoiceListItemDto`, `InvoiceLineDto`, `InvoicePreviewDto`, `InvoicePrintDto`, `GenerateInvoiceRequest`, `PreviewInvoiceQuery`, `UpdateInvoiceRequest`, `CancelInvoiceRequest`, `ListInvoicesQuery` |
| Payments | `payments.ts` | `PaymentDto`, `PaymentListItemDto`, `CreatePaymentRequest`, `UpdatePaymentRequest`, `ListPaymentsQuery` |
| Billing runs | `billing-runs.ts` | `BillingRunDto`, `BillingRunItemDto`, `CreateBillingRunRequest`, `ListBillingRunsQuery`, `ListBillingRunItemsQuery` |
| Portal | `portal.ts` | `PortalProfileDto`, `UpdatePortalProfileRequest`, `PortalSummaryDto`, `PortalSubscriptionDto`, `PortalInvoiceDto`, `PortalPaymentDto`, `PortalCloseSubscriptionRequest`, `ListPortal*Query` |
| Reports | `reports.ts` | `ReportSummaryDto`, `RevenueTimeseriesDto`, `RevenueByPlanDto`, `PaymentsSummaryDto`, `OverdueInvoiceDto`, `AgingDto`, `ExpiringSubscriptionDto`, and one query type per endpoint |
| Audit | `audit.ts` | `AuditLogDto`, `ListAuditLogsQuery` |

## 2. Conflicts with the Frontend Rules, and decisions to confirm

| # | Conflict or gap | Resolution used in this plan |
| --- | --- | --- |
| 1 | Rules section 7 names the roles `admin`, `manager`, `user`. The new schema has `ADMIN`, `STAFF`, `CUSTOMER`. | `constants/roles.ts` re-exports `Role` from the shared package and adds `STAFF_ROLES`. No magic strings anywhere. |
| 2 | Rules say `@shared/types`. The backend plan says `@brightloop/shared`. | This plan writes `@shared/types`. Use the alias your tsconfig already defines. |
| 3 | Rules list `constants/query-keys.ts` but the stack has no data-fetching library. | Default: no new library. List and detail hooks use `useEffect` with `AbortController` (allowed by rules section 10 when there is no data layer). **Option for you to approve:** TanStack Query, because it gives cache invalidation after mutations and polling for billing runs for free. The hooks in FE-F4 hide the fetch strategy, so adopting it later changes one file. |
| 4 | Rules define `global`, `layout`, `forms`, `ui` but no home for feature-specific display components (for example `InvoiceLinesTable`). | Add `components/features/<feature>/<component-name>/index.tsx`. Components used by several features move to `global/`. |
| 5 | Rules do not name a router file. | `src/router.tsx` holds the tree. Each feature exports its own `RouteObject[]` from `pages/<feature>/routes.tsx`, so modules do not edit each other's lines. This is not a barrel file. |
| 6 | Rules section 14 asks for complete code per feature. This document is the blueprint. | Each module PR delivers the section 14 items (file list, full code, shadcn usage, schemas, hooks, RBAC table, constants). |
| 7 | The finished `useLogin` navigates to `ROUTES.DASHBOARD` for everyone. A customer must land in the portal. | **The only change to finished auth code:** after login and after signup, navigate to `getHomeRoute(role)`. A and S go to `/dashboard`, C goes to `/portal`. |
| 8 | Page naming. | Per your note, `pages/` mirrors the URL. The folder is the URL segment, the file is the last segment: `index.tsx` for the list, `new.tsx`, and `detail.tsx` or `edit.tsx` for `/:id` routes. Pages are the only default exports. |
| 9 | The frontend cannot run without backend modules during Waves 1 to 3. | Typed fixtures in `src/mocks/` (FE-F7). **Option for you to approve:** MSW as a dev-only dependency, because it lets every page run against the contract before its backend module is merged. |

## 3. Backend requests (additive, already reflected in the delivered types)

| # | Request | Why the frontend needs it |
| --- | --- | --- |
| 1 | `allowedActions` on `SubscriptionDto`, `PortalSubscriptionDto` and `InvoiceDto`. | The state machine and plan flags (pausable, closable, renewable) stay in one place. The UI renders buttons from this list instead of copying rules. |
| 2 | Display names inside DTOs: `customerName`, `productName`, `variantLabel`, `planName`, `subscriptionNumber`, `invoiceNumber`, `recordedByName`, `changedByName`. | Avoids one extra request per table row. |
| 3 | A list endpoint `GET /discounts/:id/subscriptions`. The type only carries `attachedSubscriptionCount`. | Without it a discount page cannot show or detach attached subscriptions. Until then attach and detach live on the subscription detail page, which already lists its discounts. |
| 4 | Confirm that date fields accept a date-only string (`2026-11-05`). | Date pickers produce calendar dates, not timestamps. |
| 5 | Confirm what an omitted `taxId` on a subscription line means. | The line editor sends an explicit tax, or none, and the backend must treat none as zero tax. |
| 6 | `POST /payments` returns `PaymentDto` only. | After recording a payment the hook refetches the invoice. No change needed, noted for the backend owner. |
| 7 | Portal renew returns the new `PortalSubscriptionDto`. | The UI navigates to it. |

## 4. Routing with React Router

Use the router package already installed (data router API: `createBrowserRouter`, `RouterProvider`, `Outlet`, `Navigate`, `NavLink`, `useSearchParams`, `useParams`). Import from `react-router-dom` or `react-router` to match the installed major version. Routes use `element` and `React.lazy` with `Suspense`, as the rules require. Data fetching stays in hooks, so no route loaders.

### 4.1 Router tree

```tsx
// src/router.tsx
const router = createBrowserRouter([
  { element: <AuthLayout />, children: authRoutes },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: ROUTE_PATHS.HOME, element: <HomeRedirect /> },
      {
        element: <RoleGuard allowedRoles={STAFF_ROLES} />,
        children: [
          {
            element: <DashboardLayout />,
            children: [
              ...dashboardRoutes,
              ...customersRoutes,
              ...subscriptionsRoutes,
              ...invoicesRoutes,
              ...paymentsRoutes,
              ...billingRunsRoutes,
              ...reportsRoutes,
              ...catalogRoutes,
              ...adminRoutes,
            ],
          },
          { element: <PrintLayout />, children: invoicePrintRoutes },
        ],
      },
      {
        element: <RoleGuard allowedRoles={CUSTOMER_ONLY} />,
        children: [
          { element: <PortalLayout />, children: portalRoutes },
          { element: <PrintLayout />, children: portalPrintRoutes },
        ],
      },
    ],
  },
  { path: ROUTE_PATHS.FORBIDDEN, element: <ForbiddenPage /> },
  { path: '*', element: <NotFoundPage /> },
]);
```

Admin-only routes inside a feature wrap their children in `<RoleGuard allowedRoles={ADMIN_ONLY} />`, for example the product create and edit pages.

### 4.2 Guards and redirects

- `ProtectedRoute` waits for `isLoading` from `useAuth()`, then redirects unauthenticated users to the login page and remembers the target URL for after login.
- `RoleGuard` redirects a user with the wrong role to their own home route (`getHomeRoute(role)`) or renders the Forbidden state. A customer who types `/invoices` lands on `/portal`. A staff user who types `/portal` lands on `/dashboard`.
- `HomeRedirect` sends `/` to `getHomeRoute(role)`.
- UI hiding (buttons, nav links) is for experience only. The backend is the authority, and every 403 renders Forbidden.

### 4.3 URL is the state for lists

`useListQuery` stores `page`, `limit`, `search`, `sortBy`, `sortOrder` and every filter in `useSearchParams`. This gives shareable links, working back and forward buttons, and deep links from cards. Examples: `/invoices?status=CONFIRMED&overdue=true` from a dashboard card, `/invoices?customerId=12` from a customer page (this replaces nested list routes, matching backend section 3.1), `/subscriptions?dueForBilling=true`. Detail pages with tabs store the tab in `?tab=`.

### 4.4 Route map

Page files are relative to `src/pages/`. Roles are for the route. Write actions inside a page follow each module card.

| Path | Page file | Roles | Module |
| --- | --- | --- | --- |
| `/dashboard` | `dashboard/index.tsx` | A, S | FE-M13 |
| `/customers` | `customers/index.tsx` | A, S | FE-M8 |
| `/customers/new` | `customers/new.tsx` | A, S | FE-M8 |
| `/customers/:id` | `customers/detail.tsx` | A, S | FE-M8 |
| `/customers/:id/edit` | `customers/edit.tsx` | A, S | FE-M8 |
| `/subscriptions` | `subscriptions/index.tsx` | A, S | FE-M9 |
| `/subscriptions/new` | `subscriptions/new.tsx` | A, S | FE-M9 |
| `/subscriptions/from-template` | `subscriptions/from-template.tsx` | A, S | FE-M9 |
| `/subscriptions/:id` | `subscriptions/detail.tsx` | A, S | FE-M9 |
| `/subscriptions/:id/edit` | `subscriptions/edit.tsx` | A, S | FE-M9 |
| `/invoices` | `invoices/index.tsx` | A, S | FE-M10 |
| `/invoices/:id` | `invoices/detail.tsx` | A, S | FE-M10 |
| `/invoices/:id/print` | `invoices/print.tsx` (PrintLayout) | A, S | FE-M10 |
| `/payments` | `payments/index.tsx` | A, S | FE-M11 |
| `/billing-runs` | `billing-runs/index.tsx` | A, S | FE-M12 |
| `/billing-runs/:id` | `billing-runs/detail.tsx` | A, S | FE-M12 |
| `/reports` | `reports/index.tsx` | A, S | FE-M13 |
| `/reports/revenue` | `reports/revenue.tsx` | A, S | FE-M13 |
| `/reports/payments` | `reports/payments.tsx` | A, S | FE-M13 |
| `/reports/overdue` | `reports/overdue.tsx` | A, S | FE-M13 |
| `/reports/aging` | `reports/aging.tsx` | A, S | FE-M13 |
| `/reports/renewals` | `reports/renewals.tsx` | A, S | FE-M13 |
| `/catalog/products` | `catalog/products/index.tsx` | A, S | FE-M3 |
| `/catalog/products/new` | `catalog/products/new.tsx` | A | FE-M3 |
| `/catalog/products/:id` | `catalog/products/detail.tsx` | A, S | FE-M3 |
| `/catalog/products/:id/edit` | `catalog/products/edit.tsx` | A | FE-M3 |
| `/catalog/plans` | `catalog/plans/index.tsx` | A, S | FE-M4 |
| `/catalog/plans/new` | `catalog/plans/new.tsx` | A | FE-M4 |
| `/catalog/plans/:id` | `catalog/plans/detail.tsx` | A, S | FE-M4 |
| `/catalog/plans/:id/edit` | `catalog/plans/edit.tsx` | A | FE-M4 |
| `/catalog/templates` | `catalog/templates/index.tsx` | A, S | FE-M5 |
| `/catalog/templates/new` | `catalog/templates/new.tsx` | A | FE-M5 |
| `/catalog/templates/:id` | `catalog/templates/detail.tsx` | A, S | FE-M5 |
| `/catalog/templates/:id/edit` | `catalog/templates/edit.tsx` | A | FE-M5 |
| `/catalog/discounts` | `catalog/discounts/index.tsx` | A, S | FE-M6 |
| `/catalog/discounts/new` | `catalog/discounts/new.tsx` | A | FE-M6 |
| `/catalog/discounts/:id` | `catalog/discounts/detail.tsx` | A, S | FE-M6 |
| `/catalog/discounts/:id/edit` | `catalog/discounts/edit.tsx` | A | FE-M6 |
| `/catalog/taxes` | `catalog/taxes/index.tsx` | A, S | FE-M1 |
| `/catalog/payment-terms` | `catalog/payment-terms/index.tsx` | A, S | FE-M1 |
| `/admin/staff` | `admin/staff/index.tsx` | A | FE-M7 |
| `/admin/audit-logs` | `admin/audit-logs/index.tsx` | A | FE-M15 |
| `/portal` | `portal/index.tsx` | C | FE-M14 |
| `/portal/subscriptions` | `portal/subscriptions/index.tsx` | C | FE-M14 |
| `/portal/subscriptions/:id` | `portal/subscriptions/detail.tsx` | C | FE-M14 |
| `/portal/invoices` | `portal/invoices/index.tsx` | C | FE-M14 |
| `/portal/invoices/:id` | `portal/invoices/detail.tsx` | C | FE-M14 |
| `/portal/invoices/:id/print` | `portal/invoices/print.tsx` (PrintLayout) | C | FE-M14 |
| `/portal/payments` | `portal/payments/index.tsx` | C | FE-M14 |
| `/portal/profile` | `portal/profile.tsx` | C | FE-M14 |
| `/403`, `*` | `forbidden.tsx`, `not-found.tsx` | all | FE-F5 |

Auth pages (`pages/auth/...`) already exist and stay as they are.

### 4.5 Navigation

`constants/navigation.ts` holds the links, each with `allowedRoles`, filtered by `useAuth().role`. Staff sidebar groups: Overview (Dashboard), Sales (Customers, Subscriptions), Billing (Invoices, Payments, Billing runs), Reports, Catalog (Products, Plans, Templates, Discounts, Taxes, Payment terms), Admin (Staff, Audit logs; A only). Portal top nav: Overview, Subscriptions, Invoices, Payments, Profile. Password change is a link to the existing auth flow.

### 4.6 Missing records and forbidden actions

Detail hooks map a 404 to a `NotFoundState` rendered inside the layout, and a 403 to a `ForbiddenState`. Both are global components. Customers hitting someone else's id always see NotFound.

## 5. Foundation tasks (Wave 0, merge before any module)

| ID | Task | Deliverable |
| --- | --- | --- |
| FE-F1 | **Constants and roles.** `constants/roles.ts` (re-export `Role`, add `STAFF_ROLES`, `ADMIN_ONLY`, `CUSTOMER_ONLY`, `getHomeRoute`). `constants/routes.ts` with `ROUTE_PATHS` (patterns for the router) and `ROUTES` (builders such as `ROUTES.INVOICES.DETAIL(id)`). `navigation.ts`, `pagination.ts` (default limit 10, options 10, 25, 50, 100), `messages.ts` (a `Record<DomainErrorCode, string>`), and `status.ts` (label and badge variant per status enum). Apply the two auth touchpoints from section 2, row 7. | Constants merged, login lands each role on its home route |
| FE-F2 | **API plumbing.** `api/utils.ts` with `serializeQuery`, `unwrap` and `unwrapList` (returns `ListResult<T>` from `types/api.ts`). Confirm the Axios error normalizer exposes `status`, `code` and `details`. Extend `getErrorMessage` with the domain code messages. Add `lib/apply-server-errors.ts` that maps `details[]` to `form.setError`. | Utilities, typed against the shared envelope types |
| FE-F3 | **Formatting and inputs.** `lib/format.ts` (`formatPaise` with `Intl` en-IN INR, `formatBps`, `formatDate`, `formatDateTime`). `lib/money.ts` (rupee string to paise and back using string math, percent to bps and back). `lib/dates.ts` (`toDateOnly`, `todayInBusinessTz`). Global components `MoneyInput`, `PercentInput`, `DateField` (shadcn Calendar in a Popover, outputs `YYYY-MM-DD`). | Utilities with tests for 0.1 + 0.2 style cases, paise round trips, month-end dates |
| FE-F4 | **Generic hooks** in `hooks/common/`: `useDebounce`, `useListQuery<TQuery, TItem>` (URL-synced, exposes `data`, `meta`, `isLoading`, `error`, `page`, `limit`, `search`, `sortBy`, `order`, `filters` and setters, resets `page` when a filter changes, aborts stale requests), `useResource<T>` (single record: `data`, `isLoading`, `error`, `refetch`, `status`), `useDisclosure`, `usePolling`. | Hooks used by every module |
| FE-F5 | **Router, guards, layouts.** `router.tsx`, `ProtectedRoute`, `RoleGuard`, `HomeRedirect`, `DashboardLayout` (shadcn Sidebar and Breadcrumb), `PortalLayout`, `PrintLayout`, `ErrorBoundary`, `ForbiddenState`, `NotFoundState`, and the two error pages. | Skeleton with one empty route block per module |
| FE-F6 | **Global components** in `components/global/`: `DataTable`, `ListToolbar` (search plus filter slot plus reset), `MultiSelectFilter` (Popover plus Command), `DateRangeFilter`, `PageHeader`, `ConfirmDialog`, `ReasonDialog`, `StatusBadge`, `MoneyText`, `DateText`, `EmptyState`, `ErrorAlert`, `StatCard`, `RoleGate`, `EntityCombobox` (async search with debounce), `FormActions`. | Components with loading, empty and error states |
| FE-F7 | **Fixtures.** `src/mocks/<feature>.ts`, each typed with the shared DTOs. A decision on MSW (section 2, row 9). | Pages can render before the backend module exists |

Install commands for shadcn components not yet present (check `components/ui` first): `bunx shadcn@latest add button input textarea select form label dialog alert-dialog sheet table tabs badge skeleton alert pagination sidebar breadcrumb dropdown-menu popover command calendar checkbox switch separator tooltip sonner card chart scroll-area radio-group`. The `chart` component brings in `recharts`, which shadcn's chart wrapper depends on. It is used only in FE-M13.

## 6. Module cards

Every module owns `api/<feature>/index.ts`, `hooks/<feature>/`, `components/forms/<form-name>/` (`index.tsx` plus `schema.ts`), `components/features/<feature>/`, `pages/<feature>/` including `routes.tsx`, and `src/mocks/<feature>.ts`. Every card lists only what is specific to that module. Every list page uses `useListQuery`, `DataTable` and `ListToolbar` and handles loading (Skeleton), empty (`EmptyState`), error (`ErrorAlert`) and success. Every mutation hook owns its loading flag, try/catch, toast and navigation. Every write button sits inside `RoleGate`.

**Waves** mirror the backend. Wave 0: FE-F1 to FE-F7. Wave 1: FE-M1, M3, M4, M7, M8, M15 in parallel. Wave 2: FE-M5, M6. Wave 3: FE-M9. Wave 4: FE-M10, M11, M12. Wave 5: FE-M13, M14.

### FE-M1. Taxes and payment terms (Wave 1)

| Item | Detail |
| --- | --- |
| Pages | `catalog/taxes/index.tsx`, `catalog/payment-terms/index.tsx`. Create and edit happen in a Dialog on the list page, so there are no separate form pages. |
| Endpoints | `/taxes` and `/payment-terms`: list, get, create, update, delete. |
| Shared types | `TaxDto`, `CreateTaxRequest`, `UpdateTaxRequest`, `ListTaxesQuery`, `PaymentTermDto`, `CreatePaymentTermRequest`, `UpdatePaymentTermRequest`, `ListPaymentTermsQuery`. |
| Hooks | `useTaxesList` (search name, filters `type`, `isActive`, sort `name`, `rate`, `createdAt`), `useCreateTax`, `useUpdateTax`, `useDeleteTax`, `useTaxDialog` (dialog state plus the tax being edited). Same set for payment terms. Lookup hooks used by other modules: `useTaxOptions` and `usePaymentTermOptions` (limit 100, active only). |
| Forms | `forms/tax`: name, type, rate. For PERCENTAGE the input is `PercentInput` (0 to 100, two decimals, sent as 0 to 10000 bps). For FIXED it is `MoneyInput` (paise per unit). `forms/payment-term`: name, `dueDays` (integer 0 to 365), `isDefault`, `isActive` switches. |
| Behaviour | Rate column shows `18%` or `₹5.00 per unit`. Active state is a Switch in the row that calls update. Marking a term as default shows a note that the previous default is cleared. Delete uses `ConfirmDialog`. |
| Errors | `DUPLICATE` becomes a field error on name. `IN_USE` shows a toast that suggests deactivating instead, with a one-click Deactivate action. |
| RBAC | A, S view. A creates, edits, deletes. |

### FE-M3. Products and variants (Wave 1)

| Item | Detail |
| --- | --- |
| Pages | `catalog/products/index.tsx`, `new.tsx`, `detail.tsx`, `edit.tsx`. Variants are managed on the detail page in dialogs. |
| Endpoints | `/products` (list with `include=variants`, get, create with `variants[]`, update, soft delete) and `/products/:productId/variants` (list, create, update, delete). |
| Shared types | `ProductDto`, `ProductAdminDto`, `ProductVariantDto`, `CreateProductRequest`, `UpdateProductRequest`, `CreateVariantRequest`, `UpdateVariantRequest`, `ListProductsQuery`, `ListVariantsQuery`. |
| Hooks | `useProductsList` (search, filters `type`, `isActive`, `minPrice`, `maxPrice`), `useProduct`, `useCreateProduct`, `useUpdateProduct`, `useDeleteProduct`, `useVariantsList`, `useCreateVariant`, `useUpdateVariant`, `useDeleteVariant`, `useProductOptions` (active, `include=variants`, used by FE-M5 and FE-M9). The hooks return `ProductAdminDto` for A and `ProductDto` for S. |
| Forms | `forms/product` (name, type, `salesPrice`, `costPrice`, notes, isActive, and a `useFieldArray` of variants on create), `forms/variant` (attribute, value, `extraPrice`, isActive). |
| Behaviour | The cost price field and column render only for A, and the S type has no such field. The variant dialog shows the final unit price (`salesPrice + extraPrice`) using `formatPaise`, for example Odoo brand adds ₹560.00. Prices cannot be negative. Inactive products and variants are visibly marked and are hidden from option lists. |
| Errors | Duplicate variant (attribute plus value) is a field error. Variant `IN_USE` suggests deactivating. |
| RBAC | A, S view the list and detail without cost data. A creates, edits, deletes. |

### FE-M4. Plans (Wave 1)

| Item | Detail |
| --- | --- |
| Pages | `catalog/plans/index.tsx`, `new.tsx`, `detail.tsx`, `edit.tsx`. |
| Endpoints | `/plans` list, get, create, update, soft delete. |
| Shared types | `PlanDto`, `PlanRefDto`, `CreatePlanRequest`, `UpdatePlanRequest`, `ListPlansQuery`. |
| Hooks | `usePlansList` (search name and description, filters `billingPeriod`, `isActive`, `availableOn`, `autoClose`, `closable`, `pausable`, `renewable`), `usePlan`, `useCreatePlan`, `useUpdatePlan`, `useDeletePlan`, `usePlanOptions`. |
| Forms | `forms/plan`: name, description, price (`MoneyInput`), billing period (Select: daily, weekly, monthly, yearly), `minQuantity` (at least 1), `availableFrom` and `availableTo` (`DateField`, Zod refine that the end is after the start), four Switches with helper text (`autoClose`: closes by itself at the end date and then requires an expiry date on its subscriptions; `closable`; `pausable`; `renewable`), `isActive`. |
| Behaviour | Detail shows the flags as Badges, the availability window and `activeSubscriptionCount`. On edit, the billing period field is disabled with an explanation when `activeSubscriptionCount` is above 0. Flag changes show a note that they apply to existing subscriptions immediately. |
| Errors | `IN_USE` on delete or billing period change shows the active subscription count with a link to `/subscriptions?planId=<id>`. |
| RBAC | A, S view. A creates, edits, deletes. |

### FE-M7. Staff (Wave 1)

| Item | Detail |
| --- | --- |
| Page | `admin/staff/index.tsx`. Create and edit in Dialogs. |
| Endpoints | `/staff` list, get, create, update, delete, `/:id/deactivate`, `/:id/activate`. |
| Shared types | `StaffDto`, `CreateStaffRequest`, `UpdateStaffRequest`, `ListStaffQuery`. |
| Hooks | `useStaffList` (search name, email, username, filter `isActive`, sort including `lastLoginAt`), `useCreateStaff`, `useUpdateStaff`, `useStaffAccess` (activate and deactivate), `useDeleteStaff`. |
| Forms | `forms/staff`: name, email, optional username, password. Reuse the existing signup password rule by exporting it from the signup schema as `passwordSchema`, instead of rewriting it. Never send a role. |
| Behaviour | Deactivate and delete use `ConfirmDialog` and say that the person is signed out everywhere. Buttons are disabled on the logged-in admin's own row. Last login shows as a relative date. |
| Errors | `DUPLICATE` email is a field error. |
| RBAC | A only (route guard and nav). |

### FE-M8. Customers (Wave 1)

| Item | Detail |
| --- | --- |
| Pages | `customers/index.tsx`, `new.tsx`, `detail.tsx`, `edit.tsx`. |
| Endpoints | `/customers` list (with `include=summary`), get, create, update, delete. Detail tabs reuse the lists of other modules with a `customerId` filter. |
| Shared types | `CustomerDto`, `CustomerListItemDto`, `CustomerSummaryDto`, `CustomerRefDto`, `CreateCustomerRequest`, `UpdateCustomerRequest`, `ListCustomersQuery`. |
| Hooks | `useCustomersList` (search name, company, email, phone, tax id; filters `hasPortalAccount`, `hasOutstanding`, `city`, `state`, created range), `useCustomer`, `useCreateCustomer`, `useUpdateCustomer`, `useDeleteCustomer`, `useCustomerOptions(search)` for `EntityCombobox`. |
| Forms | `forms/customer`: name, email, company, phone, tax id (GST or VAT), address lines, city, state, postal code, country, notes. |
| Behaviour | List shows active subscriptions, outstanding amount and overdue count per row from `summary`. Detail shows `StatCard`s from `summary` and tabs for Subscriptions, Invoices and Payments. Each tab embeds the owning module's table with the customer filter locked, and a View all link such as `/invoices?customerId=12`. A Badge shows when the customer has a portal account. |
| Errors | `DUPLICATE` is a field error. Delete `IN_USE` explains that active or paused subscriptions, or unpaid invoices, exist. |
| RBAC | A, S create, view, edit. A deletes. |

### FE-M15. Audit logs (Wave 1)

| Item | Detail |
| --- | --- |
| Page | `admin/audit-logs/index.tsx`. |
| Endpoint | `GET /audit-logs`. |
| Shared types | `AuditLogDto`, `ListAuditLogsQuery`. |
| Hooks | `useAuditLogsList` (search on action, filters `userId`, `action`, `entityType`, `entityId`, created range, sort `createdAt`). |
| Behaviour | Row click opens a Sheet with the metadata as read-only formatted JSON. The user filter is a staff combobox that reuses `useStaffList`. Entity ids link to the matching detail page where one exists. |
| RBAC | A only. |

### FE-M5. Quotation templates (Wave 2)

| Item | Detail |
| --- | --- |
| Pages | `catalog/templates/index.tsx`, `new.tsx`, `detail.tsx`, `edit.tsx`. |
| Endpoints | `/quotation-templates` list, get, create, update, soft delete. |
| Shared types | `QuotationTemplateDto`, `QuotationTemplateListItemDto`, `QuotationTemplateLineDto`, `QuotationTemplateLineInput`, `CreateQuotationTemplateRequest`, `UpdateQuotationTemplateRequest`, `ListQuotationTemplatesQuery`. |
| Hooks | `useTemplatesList` (search name and notes, filters `planId`, `isActive`), `useTemplate`, `useCreateTemplate`, `useUpdateTemplate`, `useDeleteTemplate`, `useTemplateOptions`. |
| Forms | `forms/quotation-template`: name, plan (Select from `usePlanOptions`), `validityDays` (1 to 365), notes, and a line editor (`useFieldArray`) with product, variant (filtered to the chosen product), quantity. At least one line. |
| Behaviour | The line editor shows the current catalog price per line for information. Edit sends the full `lines` array, which replaces all lines. Delete explains that existing subscriptions are unaffected. The detail page has a Create subscription from this template button that opens `/subscriptions/from-template?templateId=<id>`. |
| RBAC | A, S view. A creates, edits, deletes. |

### FE-M6. Discounts (Wave 2)

| Item | Detail |
| --- | --- |
| Pages | `catalog/discounts/index.tsx`, `new.tsx`, `detail.tsx`, `edit.tsx`. |
| Endpoints | `/discounts` CRUD, `PUT /:id/products`, `POST /:id/subscriptions`, `DELETE /:id/subscriptions/:subscriptionId`, `GET /:id/usages`. |
| Shared types | `DiscountDto`, `DiscountUsageDto`, `CreateDiscountRequest`, `UpdateDiscountRequest`, `SetDiscountProductsRequest`, `AttachDiscountSubscriptionsRequest`, `ListDiscountsQuery`, `ListDiscountUsagesQuery`. |
| Hooks | `useDiscountsList` (search name and code, filters `type`, `scope`, `isActive`, `state`, `productId`), `useDiscount`, `useCreateDiscount`, `useUpdateDiscount`, `useDeleteDiscount`, `useSetDiscountProducts`, `useDiscountUsagesList`, `useAttachDiscount` and `useDetachDiscount` (used by FE-M9). |
| Forms | `forms/discount`: name, optional code, type (radio), value (`PercentInput` 1 to 100 percent for PERCENTAGE, `MoneyInput` at least 1 paise for FIXED), scope (radio), minimum purchase, minimum quantity, start date, end date (on or after start), usage limit (empty means unlimited), isActive, and for PRODUCT scope a product multi-select. |
| Behaviour | A tab bar on the list maps to the `state` filter: All, Upcoming, Active, Expired, Exhausted. Detail shows a usage progress bar (`usedCount` of `usageLimit`), a state Badge, tabs for Overview, Products (replace the set in a dialog), Usages (table linking to `/invoices/:id`). The scope control is disabled once `usedCount` is above 0, and `usedCount` is never an input. For SUBSCRIPTION scope the page explains that attaching happens from the subscription page. The attached-subscriptions list waits for backend request 3. |
| Errors | `DISCOUNT_NOT_APPLICABLE` explains whether the discount is expired, exhausted or inactive. |
| RBAC | A creates and edits rules. A, S view. A, S attach and detach (S only if you confirm open item 5). |

### FE-M9. Subscriptions (Wave 3)

| Item | Detail |
| --- | --- |
| Pages | `subscriptions/index.tsx`, `new.tsx`, `from-template.tsx`, `detail.tsx`, `edit.tsx`. |
| Endpoints | `/subscriptions` list, create, `/from-template`, get, update, delete, and the actions `send-quotation`, `confirm`, `activate`, `pause`, `resume`, `close`, `renew`. Also `GET /invoices/preview` and `POST /invoices/generate` for the Generate invoice button. |
| Shared types | `SubscriptionDto`, `SubscriptionListItemDto`, `SubscriptionLineDto`, `SubscriptionStatusHistoryDto`, `SubscriptionLineInput`, `CreateSubscriptionRequest`, `CreateSubscriptionFromTemplateRequest`, `UpdateSubscriptionRequest`, `CloseSubscriptionRequest`, `RenewSubscriptionRequest`, `ListSubscriptionsQuery`, `SubscriptionStatus`, `SubscriptionAction`. |
| Hooks | `useSubscriptionsList`, `useSubscription`, `useCreateSubscription`, `useCreateSubscriptionFromTemplate`, `useUpdateSubscription`, `useDeleteSubscription`, `useSubscriptionAction` (one hook, one function per action, owns the in-flight flag that disables every button), `useSubscriptionDiscounts` (attach and detach), `useSubscriptionOptions(search)`. |
| Forms | `forms/subscription` (header plus line editor), `forms/subscription-from-template`, `forms/close-subscription` (reason required). |

**List page.** Status tabs plus a multi-select, customer combobox, plan select, date ranges for start, expiry and next billing, a Due for billing toggle (`dueForBilling`), and an Expiring within select (7, 30, 60, 90 days). Columns: number, customer, plan, status Badge, start, expiry, next billing, recurring amount, total.

**Create and edit.** The header has customer, plan (the option shows price, period and flags), start date, expiry date (required when the chosen plan has `autoClose`), payment term (default preselected) and notes. The line editor uses `useFieldArray`: product, variant, tax, quantity, where quantity must be at least the plan's `minQuantity`. The editor shows the catalog unit price and `quantity x unitPrice` as an integer. It never sends `unitPrice` or `taxRate`, and the screen says that taxes and totals are calculated when saved. Edit mode is derived from status: DRAFT and QUOTATION allow the whole form (lines replaced as a whole), CONFIRMED and later allow only notes and payment term, and every other field is disabled.

**From template.** Pick a template (preview of plan, lines and validity days), customer, start and expiry dates, payment term, notes. Submit calls `/from-template` and navigates to the new draft.

**Detail page.** Header with number, `StatusBadge`, customer link and plan. A `SubscriptionStatusStepper` shows Draft, Quotation, Confirmed, Active, Closed, with Paused shown as a branch under Active. The action bar renders only the buttons present in `allowedActions`, using a constant map `SUBSCRIPTION_ACTIONS` (label, icon, confirmation text, whether a reason is needed). Close opens `ReasonDialog` with a required reason. Renew navigates to the new draft. Generate invoice (visible when ACTIVE) opens a dialog that calls the invoice preview first, then generate. Tabs: Lines (table with subtotal, tax, total and recurring amount), Invoices (the last 5 plus View all to `/invoices?subscriptionId=<id>`), Discounts (attached list with detach, and an attach dialog that lists active SUBSCRIPTION-scope discounts), History (timeline from `statusHistory`). A banner shows the quotation validity date. Delete is A only and DRAFT only.

| Error code | UI response |
| --- | --- |
| `INVALID_STATE_TRANSITION` | Toast that someone else changed the status, then refetch the record |
| `ACTION_NOT_ALLOWED_BY_PLAN` | Toast naming the plan flag that blocks the action |
| `PLAN_NOT_AVAILABLE` | Field error on start date with the plan's window |
| `QUOTATION_EXPIRED` | Alert on the page and the Confirm button removed after refetch |
| `VALIDATION_ERROR` on lines | `applyServerErrors` maps to `lines.<index>.quantity` and similar paths |
| `NOTHING_TO_BILL`, `ALREADY_BILLED` | Info state in the Generate dialog, not an error toast |

**RBAC.** A, S for every action. A only deletes.

### FE-M10. Invoices (Wave 4)

| Item | Detail |
| --- | --- |
| Pages | `invoices/index.tsx`, `detail.tsx`, `print.tsx` (PrintLayout). There is no create-by-hand page and no delete: invoices are generated, cancelled, never deleted. |
| Endpoints | `/invoices` list, `/preview`, `/generate`, get, patch, `/confirm`, `/cancel`, `/send`, `/print`. |
| Shared types | `InvoiceDto`, `InvoiceListItemDto`, `InvoiceLineDto`, `InvoicePreviewDto`, `InvoicePrintDto`, `GenerateInvoiceRequest`, `PreviewInvoiceQuery`, `UpdateInvoiceRequest`, `CancelInvoiceRequest`, `ListInvoicesQuery`, `InvoiceStatus`, `InvoiceAction`. |
| Hooks | `useInvoicesList`, `useInvoice`, `useInvoiceAction` (confirm, cancel, send), `useUpdateInvoice`, `useInvoicePreview`, `useGenerateInvoice`, `useInvoicePrint`. |
| Forms | `forms/generate-invoice` (subscription combobox limited to ACTIVE, `asOf` date, `autoConfirm` switch), `forms/cancel-invoice` (reason required), `forms/edit-invoice` (notes, due date, DRAFT only). |

**List page.** Tabs All, Draft, Confirmed, Paid, Cancelled plus chips Outstanding and Overdue (`outstanding`, `overdue`). Filters: customer, subscription, issue and due ranges, min and max total (`MoneyInput`), billing run. Columns: number, customer, period, issue date, due date, total, amount due, status Badge plus a red overdue Badge from `isOverdue` and `daysOverdue`.

**Detail page.** Buttons come from `allowedActions`: Edit, Confirm, Cancel (`ReasonDialog`), Send, Record payment (opens the dialog from FE-M11). Print links to the print page. Body: customer snapshot, billing period, lines table (quantity, unit price, discount, tax, amount), a totals card (subtotal, discount, tax, total, paid, due), a payments table, and the discount usages. Cancel explains that the period is not billed again automatically. A failed send (`DELIVERY_FAILED`, 503) shows an inline Alert with a Retry button and leaves the invoice unchanged.

**Print.** `components/features/invoices/invoice-print-view` renders an `InvoicePrintDto` with Tailwind `print:` utilities. `PrintLayout` has no sidebar. A Print button calls `window.print()`. The portal print page reuses the same view. The frontend formats currency and dates, because the DTO carries raw paise.

**RBAC.** A, S for everything.

### FE-M11. Payments (Wave 4)

| Item | Detail |
| --- | --- |
| Page | `payments/index.tsx`. Record payment is a Dialog opened from an invoice. |
| Endpoints | `/payments` list, get, create, patch, delete. |
| Shared types | `PaymentDto`, `PaymentListItemDto`, `CreatePaymentRequest`, `UpdatePaymentRequest`, `ListPaymentsQuery`, `PaymentMethod`. |
| Hooks | `usePaymentsList` (search reference, note, invoice number, customer; filters `invoiceId`, `customerId`, `method`, paid range, `minAmount`, `maxAmount`), `useRecordPayment`, `useUpdatePayment`, `useDeletePayment`. |
| Forms | `forms/record-payment`: amount (`MoneyInput`, at least 1 paise, prefilled with `amountDue`), method, payment date (default today, not in the future), reference, note. `forms/edit-payment` (reference and note only). |
| Behaviour | After a successful payment the hook refetches the invoice, because the response carries only the payment. A fully paid invoice flips to PAID and the dialog button disappears. Editing a payment never changes amount, date or invoice. Deleting (A only) uses `ConfirmDialog` that says a paid invoice returns to Confirmed. |
| Errors | `OVERPAYMENT` becomes a field error on amount with the maximum shown. `INVOICE_NOT_PAYABLE` shows an Alert and refetches the invoice. |
| RBAC | A, S record, list, edit. A deletes. |

### FE-M12. Billing runs (Wave 4)

| Item | Detail |
| --- | --- |
| Pages | `billing-runs/index.tsx`, `detail.tsx`. |
| Endpoints | `/billing-runs` list, create, get, `/:id/items`, `/:id/retry-failed`. |
| Shared types | `BillingRunDto`, `BillingRunItemDto`, `CreateBillingRunRequest`, `ListBillingRunsQuery`, `ListBillingRunItemsQuery`, `BillingRunStatus`, `BillingRunItemStatus`. |
| Hooks | `useBillingRunsList` (filters `status`, run date range, `triggeredById`), `useBillingRun(id)` (polls while RUNNING), `useBillingRunItemsList` (filters `status`, `subscriptionId`, search), `useStartBillingRun`, `useRetryFailedItems`. |
| Forms | `forms/start-billing-run`: run date (default today, never in the future), `autoConfirm` switch. The optional `subscriptionIds` field is left out of the first release. |
| Behaviour | Start returns 201 with status RUNNING, so the hook navigates to the detail page. `usePolling` refetches every 3 seconds while status is RUNNING and stops when it changes or the page unmounts (the timer is cleared in the effect cleanup). Summary cards show total due, created, skipped and failed. Items table shows the status Badge and the message. A Retry failed button appears when `failedCount` is above 0 and the run is not RUNNING. Created invoices link to `/invoices?billingRunId=<id>`. Runs started by the scheduler show System as the trigger. |
| Errors | `BILLING_RUN_IN_PROGRESS` shows an Alert that a run for that date is already running. |
| RBAC | A, S. |

### FE-M13. Reports and dashboard (Wave 5)

| Item | Detail |
| --- | --- |
| Pages | `dashboard/index.tsx`, `reports/index.tsx`, `revenue.tsx`, `payments.tsx`, `overdue.tsx`, `aging.tsx`, `renewals.tsx`. |
| Endpoints | `/reports/summary`, `/revenue/timeseries`, `/revenue/by-plan`, `/payments/summary`, `/invoices/overdue`, `/aging`, `/subscriptions/expiring`. |
| Shared types | `ReportSummaryDto`, `RevenueTimeseriesDto`, `RevenueByPlanDto`, `PaymentsSummaryDto`, `OverdueInvoiceDto`, `AgingDto`, `ExpiringSubscriptionDto` and their query types. |
| Hooks | `useReportSummary`, `useRevenueTimeseries`, `useRevenueByPlan`, `usePaymentsSummary`, `useOverdueInvoicesList`, `useAging`, `useExpiringSubscriptionsList`. Each report page keeps its range, plan and customer filters in the URL. |

**Dashboard.** `StatCard`s for active subscriptions, MRR, revenue received this month, outstanding and overdue (the overdue card links to `/invoices?overdue=true`). A revenue chart (invoiced against received, last 12 months, monthly). The top 5 overdue invoices and the top 5 subscriptions expiring within 30 days. Quick actions: New subscription, Run billing, Record payment. Each block loads on its own, so one slow query never blanks the page.

**Report pages.** Summary has a date range (default current month), plan and customer filters, and the status breakdown. Revenue has a day, week or month switch (day is limited to 366 days, so the picker blocks a longer range) with the timeseries chart and a by-plan table. Payments shows one row per method plus a total. Overdue is a standard `DataTable` with filters `minDaysOverdue`, `minAmount`, due range, customer, subscription. Aging shows five bucket cards (not yet due, 1 to 30, 31 to 60, 61 to 90, over 90) with a bar chart and a customer filter. Renewals lists active subscriptions expiring soon or already past expiry without `autoClose`, with a link to each subscription.

**Charts** use the shadcn `chart` component. Chart values are paise, formatted by `formatPaise` in tooltips and axes. Targets from the problem statement: every page responds in under 2 seconds, so each page fetches only what is visible and nothing is fetched in bulk.

**RBAC.** A, S.

### FE-M14. Customer portal (Wave 5)

| Item | Detail |
| --- | --- |
| Pages | `portal/index.tsx`, `portal/subscriptions/index.tsx` and `detail.tsx`, `portal/invoices/index.tsx`, `detail.tsx` and `print.tsx`, `portal/payments/index.tsx`, `portal/profile.tsx`. |
| Endpoints | `/me` (GET, PATCH), `/portal/summary`, `/portal/subscriptions` (list, get, pause, resume, close, renew), `/portal/invoices` (list, get, print), `/portal/payments`. |
| Shared types | `PortalProfileDto`, `UpdatePortalProfileRequest`, `PortalSummaryDto`, `PortalSubscriptionDto`, `PortalSubscriptionListItemDto`, `PortalInvoiceDto`, `PortalInvoiceListItemDto`, `PortalPaymentDto`, `PortalCloseSubscriptionRequest`, `ListPortalSubscriptionsQuery`, `ListPortalInvoicesQuery`, `ListPortalPaymentsQuery`, `InvoicePrintDto`. |
| Hooks | `usePortalProfile`, `useUpdatePortalProfile`, `usePortalSummary`, `usePortalSubscriptionsList`, `usePortalSubscription`, `usePortalSubscriptionAction`, `usePortalInvoicesList`, `usePortalInvoice`, `usePortalInvoicePrint`, `usePortalPaymentsList`. |
| Forms | `forms/portal-profile` (name, company, phone, tax id, address; email is read-only), `forms/portal-close-subscription` (optional reason). |

**Behaviour.** Portal pages import only `Portal*` DTOs and never the staff DTOs, which keeps staff-only fields out of customer screens by construction. The overview shows active subscriptions, next billing date, outstanding amount and overdue count and amount. Subscription detail renders Pause, Resume, Close and Renew only if they appear in `allowedActions`. The Renew confirmation says it starts when the current term ends and activates straight away (open item 4). Invoices default to CONFIRMED and PAID with an overdue Badge, and reuse `InvoicePrintView`. The first request for a new account creates the customer record on the backend, so the overview shows a Skeleton rather than an error while it loads. Empty states are friendly ('No subscriptions yet'). The profile page links to the existing change-password flow.

**Access.** 404 always renders NotFound. A staff user who types a portal URL is redirected to `/dashboard`. **RBAC:** C only.

## 7. Working in parallel without conflicts

1. **Ownership.** An owner edits only `api/<feature>/`, `hooks/<feature>/`, `components/forms/<form>/`, `components/features/<feature>/`, `pages/<feature>/` and `src/mocks/<feature>.ts`.
2. **Shared touchpoints are append-only.** `constants/routes.ts`, `constants/navigation.ts`, `constants/messages.ts`, `constants/status.ts` and the feature line in `router.tsx`. When merges collide, keep both lines.
3. **Shared types are read-only for the frontend.** Never edit `shared/src/types` from a frontend PR. Request additive changes from the module's backend owner. Never redeclare a DTO locally as a workaround.
4. **Global components** (`components/global/`) change only through a PR from the Foundation owner, or with that owner's approval, because every module uses them.
5. **shadcn files** in `components/ui` are installed with the CLI and not hand-edited.
6. **Interface first.** On day one each owner merges the `api/<feature>/index.ts` file (typed signatures with bodies) and the `mocks/<feature>.ts` fixtures, so dependent modules, for example FE-M9 using FE-M3 options, build against them.
7. **Branches and size.** `feat/fe-<module>-<task>`, at most 500 changed lines per PR. CI runs typecheck, lint and build.
8. **Arbitration.** The Foundation owner decides disputes about conventions.

## 8. Quality checks

- **Types.** `strict` typecheck passes with no `any`, no `@ts-ignore`, no non-null assertions without a reason, and `import type` for type imports.
- **RBAC by hand.** Test every module with three accounts (A, S, C): hidden buttons, redirect on a forbidden URL, and a 403 or 404 rendered correctly when the backend refuses.
- **Money and dates.** Unit tests for `serializeQuery`, `formatPaise`, rupee-to-paise conversion (0.1, 0.10, 560, 1,234.5), bps conversion (18, 0.5, 100) and date-only handling, if the repo has a test runner (Vitest is the natural choice with Bun and Vite). If it has none, say so in the PR instead of adding one silently.
- **States.** Every list and detail page demonstrably shows loading, empty, error and success states.
- **Performance.** Lists are paginated (never fetch all), search is debounced, filter changes abort stale requests, route pages are lazy-loaded. Check each list against the backend perf seed (5k customers, 10k subscriptions, 30k invoices) and expect every page under 2 seconds.
- **Accessibility.** Labels on every input, keyboard-operable dialogs and menus, status never conveyed by color alone (Badges carry text).

## 9. Definition of Done (every module PR)

1. Routes appear in the route map with the right guard. Nav links carry `allowedRoles`.
2. Pages are thin. Logic lives in hooks. Every mutation hook owns loading, try/catch, toast and navigation.
3. All request, response and query types are imported from `@shared/types`. No local redefinition.
4. Forms use shadcn `Form`, Zod and `zodResolver`, with `defaultValues`. Submit sends the shared request type. Server `details[]` map to fields.
5. Domain error codes from the module card are handled with specific messages.
6. Loading, empty, error, success states and role checks are present.
7. The PR description lists: file list with full paths, shadcn components used and which of their features, Zod schemas and shared types used, hooks and the state each owns, an RBAC table, new constants, env variables and install commands, screenshots or a short recording, and anything unverified.

## 10. Suggested split across five developers

| Dev | Tasks | Waits for |
| --- | --- | --- |
| FE1 | FE-F1 to FE-F7, then FE-M7 Staff, FE-M15 Audit logs | Nothing. Everyone else waits for FE-F1 to FE-F6 |
| FE2 | FE-M1 Taxes and payment terms, FE-M3 Products, FE-M4 Plans, FE-M5 Templates | FE-F1 to FE-F6 |
| FE3 | FE-M8 Customers, FE-M6 Discounts, then FE-M9 Subscriptions | FE-F1 to FE-F6. FE-M9 uses options hooks from FE2 (fixtures until merged) |
| FE4 | FE-M10 Invoices, FE-M11 Payments, FE-M12 Billing runs | FE-M9 types and fixtures. FE-M10 and FE-M11 agree the Record payment dialog on day one |
| FE5 | FE-M13 Reports and dashboard, then FE-M14 Portal | FE-F6. FE-M14 reuses `InvoicePrintView` from FE-M10 and the subscription line table from FE-M9 |

Day 1 for everyone: merge your `api/<feature>/index.ts` and `mocks/<feature>.ts`. FE3 and FE4 agree on the shared `SubscriptionLinesTable` and `InvoiceLinesTable` components, which FE5 reuses in the portal.

## 11. Open items needing your decision

1. TanStack Query or the plain hooks (section 2, row 3).
2. MSW as a dev dependency or typed fixtures only (section 2, row 9).
3. Accept backend requests 1 to 5 in section 3. Requests 1 and 2 are the most important.
4. Portal renew auto-activates (current default, backend open item 3). The confirmation text depends on it.
5. Staff can attach discounts to subscriptions (current default) or only the admin. This decides whether S sees the attach buttons.
6. Int or BigInt for money (backend open item 1). The delivered types use `Paise = number`. If the backend picks BigInt, JSON would carry strings and `Paise` would change before the types are frozen.
7. The alias for the shared package (`@shared/types` or `@brightloop/shared`).
8. UI copy for cancelled invoices: a cancelled period is not billed again (backend decision 10). Say so if you need re-billing.
9. Unverified: that every date field accepts a date-only string, and what an omitted tax means on a subscription line (section 3, rows 4 and 5).
