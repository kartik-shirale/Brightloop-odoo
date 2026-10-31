import { baseConfigs, globals, tseslint } from "../../eslint.shared.mjs";

// ESLint config for @odoo/core. Lets you run `eslint .` / `bun lint` from
// inside apps/core with the same rules as the repo root.

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src/prisma/contract.d.ts"] },

  ...baseConfigs,

  // Backend source runs in Node
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  }
);
