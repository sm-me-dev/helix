import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Flat ESLint config for the Helix harness repo (CLI + pack generator + evals; no site, no React). */
export default tseslint.config(
  {
    // Generated or machine-local trees: linting them buries real findings (a stray
    // .vercel/output once produced 4,467 errors).
    ignores: [
      "node_modules/**",
      ".vercel/**",
      ".tanstack/**",
      ".serena/**",
      "graphify-out/**",
      "evals/results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
