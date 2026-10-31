import {
  baseConfigs,
  globals,
  reactPlugins,
  reactRules,
  tseslint,
} from "./eslint.shared.mjs";

// Repo-root config — `bun lint` / `bun lint:fix` at the project root.
// Each app also has its own `eslint.config.mjs` so linting from inside
// apps/web or apps/core picks up the identical rules (flat-config `files`
// patterns are relative to the directory ESLint runs in).

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "apps/web/.vite/**", "**/src/prisma/contract.d.ts"] },

  ...baseConfigs,

  // Backend (@odoo/core) runs in Node
  {
    files: ["apps/core/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Frontend (@odoo/web) runs in the browser
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // React rules for web sources
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: reactPlugins,
    rules: reactRules,
  },

  // Vite config runs in Node
  {
    files: ["apps/web/vite.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  }
);
