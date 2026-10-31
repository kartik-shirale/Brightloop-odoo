/**
 * Shared types for the odoo monorepo.
 *
 * Types live in `src/types/*`, grouped by domain (e.g. `api.ts`).
 * Re-export new files here so consumers can import everything from
 * `@odoo/shared`:
 *
 *   import type { HealthResponse } from "@odoo/shared";
 *
 * Types are import-only (`import type`), so edits to this package never
 * require restarting the dev servers.
 *
 * After changing files run `bun build` (or `bun dev`, which rebuilds this
 * package before starting the workspace) so consumers pick up new
 * declarations.
 */
export * from "./types/api.js";
