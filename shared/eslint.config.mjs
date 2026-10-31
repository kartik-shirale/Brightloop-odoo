import { baseConfigs, tseslint } from "../eslint.shared.mjs";

// ESLint config for @odoo/shared (pure type definitions — no runtime globals).

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },

  ...baseConfigs
);
