/**
 * Shared ESLint building blocks for the monorepo.
 *
 * The root `eslint.config.mjs` (used by `bun lint` at the repo root) and the
 * per-package configs in apps and the shared folder (used when linting from
 * inside a package) all import from here so the rules stay in sync.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export { js, tseslint, globals, reactHooks, reactRefresh };

// Recommended JS + TypeScript rules, applied everywhere.
export const baseConfigs = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
];

// Fast-refresh / hooks rules for React component files.
export const reactPlugins = {
  "react-hooks": reactHooks,
  "react-refresh": reactRefresh,
};

export const reactRules = {
  "react-hooks/rules-of-hooks": "error",
  "react-hooks/exhaustive-deps": "warn",
  "react-refresh/only-export-components": [
    "warn",
    { allowConstantExport: true },
  ],
};
