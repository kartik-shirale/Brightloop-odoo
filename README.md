# odoo

Bun monorepo.

## Layout

| Package         | Path          | Stack                            |
| --------------- | ------------- | -------------------------------- |
| `@odoo/core`    | `apps/core`   | Node.js + Express 5 + TypeScript |
| `@odoo/web`     | `apps/web`    | React 19 + Tailwind 4 + Vite 8   |
| `@odoo/shared`  | `shared`      | Shared types & API contracts     |

```
odoo/
├── apps/
│   ├── core/        # Express backend
│   └── web/         # React + Vite frontend
├── shared/          # @odoo/shared
│   └── src/
│       ├── index.ts # barrel — re-export every types/* file here
│       └── types/   # domain groups, e.g. api.ts, user.ts, ...
├── eslint.config.mjs
└── package.json     # root workspaces: apps/* + shared
```

Latest versions pinned via carets: express ^5.3.0, vite ^8.3.5, typescript ^7.0.2 (in apps), tailwindcss ^4.3.3, react ^19.3.1.

## Shared types workflow

`@odoo/shared` compiles its declarations to `shared/dist` (`main`/`types` point there).
Both apps depend on it with `"@odoo/shared": "workspace:*"` and import types via
`import type { ... } from "@odoo/shared"`.

- `bun dev` and `bun typecheck` rebuild `@odoo/shared` first, so consumers always
  see fresh declarations when you add/change shared types.
- Types are import-only (`import type`), so edits to `shared/src` never require
  restarting the dev servers.

## Getting started

```bash
bun install
bun dev        # builds shared, then runs core (port 3001) + web (port 3000)
```

Individual packages:

```bash
bun dev:core   # Express API on http://localhost:3001
bun dev:web    # Vite dev server on http://localhost:3000 (proxies /api → core)
```

## Other scripts

- `bun build` — build shared + both apps
- `bun lint` — ESLint 10 flat config (`eslint.config.mjs`), TS-aware via typescript-eslint
- `bun lint:fix` — auto-fix lint issues
- `bun typecheck` — typecheck shared + both apps
- `bun run clean` — clean build outputs
