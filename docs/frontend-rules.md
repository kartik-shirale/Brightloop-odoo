# FRONTEND ENGINEERING RULES (MANDATORY FOR EVERY TASK)

Stack: React, TypeScript (strict), shadcn/ui, Zod, Axios. Monorepo managed with Bun.
Backend request/response types live in the shared package (`@shared/types`, adjust to your actual alias). Always import them from there. Never redefine a backend type in the frontend.

Follow every rule below in all generated code. If a request conflicts with a rule, point out the conflict and follow the rule unless I explicitly override it.

---

## 1. Folder structure

```
src/
├── api/
│   ├── client.ts                 # single Axios instance + interceptors
│   ├── auth/
│   │   └── index.ts              # login, signup, logout, refresh, me
│   └── <feature>/index.ts
├── components/
│   ├── global/                   # reusable app-wide components
│   │   └── <component-name>/index.tsx
│   ├── layout/                   # app layouts
│   │   ├── auth/index.tsx
│   │   └── dashboard/index.tsx
│   ├── forms/                    # every application form
│   │   └── <form-name>/
│   │       ├── index.tsx
│   │       └── schema.ts         # Zod schema + inferred type
│   └── ui/                       # shadcn components ONLY (never hand-edit unless required)
├── constants/                    # nav links, roles, routes, query keys, config values
├── context/
│   └── auth-context.tsx          # context + provider only
├── hooks/
│   ├── auth/
│   │   ├── use-auth.ts           # wraps the auth context
│   │   ├── use-login.ts
│   │   └── use-signup.ts
│   └── <feature>/use-*.ts
├── lib/                          # utils (cn, formatters), helpers
├── pages/ (or routes/)           # route-level components, thin
├── types/                        # frontend-only types (UI state, props shared across files)
└── main.tsx / App.tsx
```

## imp : pages folder is the actual routes. liek auth/signup or signin or forgetpass.tsx
Rules:
- Each component lives in its own folder with `index.tsx` (in `global`, `layout`, `forms`). Sub-components used only by that component live inside its folder.
- Pages are thin: compose layout + feature components + hooks. No business logic in pages.
- No barrel files that re-export entire folders. Import from the component's folder directly.
- Use path aliases (`@/components/...`), never deep relative paths (`../../../`).

---

## 2. shadcn/ui usage (check before building)

Before creating ANY new component:
1. Check whether `components/ui` already has a shadcn component that covers the need (Button, Dialog, Sheet, Drawer, Table, Form, Select, Combobox, Command, Popover, Tabs, Tooltip, Skeleton, Badge, Alert, Pagination, Sidebar, Breadcrumb, DropdownMenu, Calendar, DatePicker, Toast/Sonner, etc.).
2. Open the component's source file and the official shadcn docs. Read its props, variants, sizes, sub-components, and composition pattern.
3. Use its built-in features before writing custom code (variants, `asChild`, `disabled`, loading patterns, controlled/uncontrolled modes, keyboard and a11y behavior).
4. If a needed shadcn component is not installed, say so and name the install command (`bunx shadcn@latest add <name>`) instead of building a custom replacement.
5. Compose shadcn components in `global/` wrappers when a pattern repeats (e.g. `DataTable`, `ConfirmDialog`, `PageHeader`). Do not fork or duplicate shadcn primitives.
6. Use `cn()` for class merging. Use Tailwind theme tokens (`bg-background`, `text-muted-foreground`), never hardcoded colors.

Always state in the response which shadcn components were used and which features of them were applied.

---

## 3. Components

- Function components only, named exports for components, default export only for pages if the router needs it.
- A component renders UI. Logic goes in hooks. If a component has more than 2 related `useState` calls, or any data fetching, side effect, or derived logic, extract a custom hook.
- Props typed with an explicit `interface <Name>Props`. No `any`. No `React.FC`.
- Keep components small (single responsibility). Split when JSX gets deeply nested or exceeds ~150 lines.
- Handle all UI states: loading (Skeleton), empty, error (Alert), success.
- Accessibility: labels for inputs, `aria-*` where shadcn does not provide it, keyboard-operable interactions.
- Stable `key` props from IDs, never array index for dynamic lists.
- No inline anonymous objects/functions passed to memoized children.

---

## 4. Hooks (use heavily)

- Naming: `use-<name>.ts` file, `use<Name>` function, grouped by feature (`hooks/auth/use-login.ts`).
- Every form submit flow, data-fetching flow, modal/dialog state, table state (pagination, search, sort, filters), and multi-step state gets its own hook.
- A hook returns an object with named fields (not positional arrays) unless it mirrors `useState`.
- Hooks own: loading state, error state, try/catch, toast notifications, navigation after success. Components only call the hook and render.
- Hook return values are stable: wrap returned handlers in `useCallback`, returned derived objects in `useMemo`.
- List/table hooks expose: `data`, `meta` (pagination), `isLoading`, `error`, `page`, `limit`, `search`, `sortBy`, `order`, `filters`, and setters. Search input is debounced via a `useDebounce` hook.
- Example shape:
```ts
export function useLogin() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const login = useCallback(async (values: LoginFormValues) => {
    setIsLoading(true);
    try {
      const session = await authApi.login(values);
      setSession(session);
      navigate(ROUTES.DASHBOARD);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [setSession, navigate]);

  return { login, isLoading };
}
```

---

## 5. Forms (Zod + shadcn Form)

- Every form is a folder in `components/forms/<name>/` with `index.tsx` and `schema.ts`.
- `schema.ts` exports the Zod schema and the inferred type: `export type LoginFormValues = z.infer<typeof loginSchema>`.
- Use shadcn `Form` components with `react-hook-form` and `zodResolver`. Provide `defaultValues` always.
- Form components contain only the UI and `useForm`. Submit logic comes from a hook (`useLogin`, `useCreateUser`).
- New passwords must exceed eight characters and include uppercase, lowercase, and a special character, with the 72-byte bcrypt limit. Existing login passwords are not subjected to the new creation policy.
- Match Zod rules to backend validation. When the backend has a shared schema/type in the shared package, reuse or extend it instead of rewriting.
- Show field-level errors via `FormMessage`. Show server errors via toast or `Alert`. Map backend `error.details[]` (`{ field, message }`) to `form.setError`.
- Disable the submit button and show a spinner while submitting. Prevent double submit.
- Reset or close the form on success where it makes sense.

---

## 6. API layer (Axios)

- One Axios instance in `api/client.ts`: `baseURL` from env, timeout, JSON headers.
- Request interceptor attaches the access token. Response interceptor handles 401 (single refresh attempt with a queue for concurrent requests, then logout), and normalizes errors into one `ApiError` shape.
- Backend envelope: `{ success, message, data, meta }` for success and `{ success: false, message, error: { code, details } }` for errors. API functions return the typed `data` (and `meta` for lists), not the raw Axios response.
- API files hold only calls: one exported object or function set per feature (`api/auth/index.ts`). No React, no toast, no navigation, no try/catch (errors propagate to the hook).
- All request params, bodies, and responses typed with shared package types.
- Always `async/await`. No `.then()` chains.
- Support request cancellation (`AbortSignal`) for search and list calls.
- Env access only through a typed `config` constant, not scattered `import.meta.env`.

```ts
export const authApi = {
  login: async (payload: LoginRequest): Promise<AuthSession> => {
    const { data } = await client.post<ApiResponse<AuthSession>>('/auth/login', payload);
    return data.data;
  },
};
```

---

## 7. Auth context and RBAC

- App is multi-role: `ADMIN`, `STAFF`, `CUSTOMER`. Roles are defined once as a const/enum in `constants/roles.ts` (or taken from the shared package). No magic strings.
- `context/auth-context.tsx` exports `AuthContext` and `AuthProvider` only. It holds: `user`, `role`, `isAuthenticated`, `isLoading` (initial session check), `setSession`, `logout`.
- Components never use `useContext(AuthContext)` directly. Always the custom hook `useAuth()` from `hooks/auth/use-auth.ts`, which throws if used outside the provider.
- Memoize the context value with `useMemo` and its functions with `useCallback`.
- Provide `hasRole(...roles)` helper from `useAuth`.
- Create guards in `components/global/`: `ProtectedRoute` (requires auth) and `RoleGuard` (requires allowed roles; redirects or renders a Forbidden state).
- Role-based nav: nav links in `constants/navigation.ts` each carry `allowedRoles`. Filter them by the current role. UI hiding is for UX only; the backend is the authority.
- Authenticated ADMIN/STAFF users land at `/dashboard`; CUSTOMER users land at `/portal`, using `getHomeRoute(role)`. Keep internal and customer route guards separate.
- Handle the auth `isLoading` state before redirecting, to avoid flicker or redirect loops.
- Token storage: prefer memory + httpOnly cookie refresh. If localStorage is unavoidable, access it only inside the auth layer, never in components.

---

## 8. Constants

- All constants in `constants/`, split by concern: `navigation.ts`, `roles.ts`, `routes.ts`, `query-keys.ts`, `pagination.ts`, `messages.ts`.
- Use `as const` and derive types from them.
- No hardcoded route strings, roles, limits, or messages inside components or hooks.

---

## 9. Performance and memoization

- Do not memoize by default. Memoize when there is a reason:
  - `useMemo`: expensive computation, or an object/array passed to a memoized child, context value, or a dependency of another hook.
  - `useCallback`: handlers passed to memoized children or used in dependency arrays.
  - `React.memo`: list items and heavy components that receive stable props.
- Never memoize cheap calculations or primitives.
- Dependency arrays must be complete and honest. Never silence `react-hooks/exhaustive-deps`. Fix the cause instead.
- Lazy-load route-level pages with `React.lazy` + `Suspense`.
- Virtualize or paginate long lists. Debounce search inputs.
- Avoid creating components inside components.

---

## 10. useEffect rules

- `useEffect` is only for synchronizing with external systems (subscriptions, event listeners, timers, imperative APIs, initial data fetch when there is no data layer).
- Do NOT use `useEffect` for: derived state (compute during render or `useMemo`), responding to user events (use handlers), resetting state on prop change (use `key`), or chaining state updates.
- Async inside effects: define an inner `async` function and call it. Never make the effect callback itself async.
- Every effect that subscribes, sets timers, or fetches must clean up (remove listener, clear timer, abort request via `AbortController`, ignore stale responses).
- One effect = one purpose. Split unrelated effects.

---

## 11. Async and error handling

- `async/await` only. No promise chains.
- try/catch lives in hooks (and event handlers), not in API functions or presentational components.
- Use `finally` to reset loading states.
- Single `getErrorMessage(error: unknown)` util converts `ApiError`, `AxiosError`, and unknown errors into a user-safe string. Use `unknown` in catch blocks, never `any`.
- Never swallow errors silently. Either show feedback (toast/Alert/form error) or rethrow.
- Add an `ErrorBoundary` at the app and layout level for render errors.
- Handle status codes intentionally: 400/422 field errors to the form, 401 to refresh/logout, 403 to Forbidden state, 404 to NotFound state, 409 to a clear conflict message, 429 to retry message, 5xx to a generic failure message.

---

## 12. TypeScript standards

- `strict: true`. No `any`, no non-null `!` without justification, no `@ts-ignore`.
- Prefer `interface` for object shapes and props, `type` for unions and utility types.
- Infer types from Zod and constants instead of duplicating them.
- Explicit return types on exported functions and hooks.
- Use discriminated unions for multi-state UI where it helps.
- Import types with `import type`.

---

## 13. Code style

- Clean and readable. Minimal comments: only for non-obvious "why". No comments that restate the code. No commented-out code.
- Naming: components `PascalCase`, hooks `useCamelCase`, files and folders `kebab-case`, constants `UPPER_SNAKE_CASE`, booleans `is/has/can` prefix, handlers `handle*` (in components) or `on*` (props).
- Early returns over nested conditionals. No nested ternaries.
- No `console.log`. No unused imports or variables.
- ESLint and Prettier compliant.
- Do not add libraries outside this stack without stating why.

---

## 14. Output requirements for every task

When I ask for a feature, deliver:
1. File list with full paths following the structure above.
2. Complete code for every file (no placeholders, no "...rest of code").
3. Which shadcn components were checked and used, and which features were applied.
4. Zod schemas and the shared types used (import paths).
5. Which hooks were created and what state each one owns.
6. RBAC: which roles can access each route or UI section (small table).
7. Any new constants, env variables, or install commands.

Do not skip loading, empty, and error states, validation, role checks, or typing to keep the answer short.
