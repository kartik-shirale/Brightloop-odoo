import {
  baseConfigs,
  globals,
  reactPlugins,
  reactRules,
  tseslint,
} from "../../eslint.shared.mjs";

// ESLint config for @odoo/web. Lets you run `eslint .` / `bun lint` from
// inside apps/web with the same rules as the repo root.
// NOTE: `files` globs are relative to this directory (apps/web).

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", ".vite/**", "test-results/**", "playwright-report/**"] },

  ...baseConfigs,

  // App source runs in the browser
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // React hooks + fast-refresh rules
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: reactPlugins,
    rules: reactRules,
  },

  // Vite config runs in Node
  {
    files: ["vite.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  }
);
