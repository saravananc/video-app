import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared flat ESLint config consumed by every package (FAV-101). */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "warn"
    }
  },
  {
    ignores: ["dist/**", ".next/**", "node_modules/**", "*.config.*"]
  }
);
