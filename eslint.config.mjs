import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // CLAUDE.md Definition of Done: no console.log left behind.
      // warn/error are allowed so real problems can still surface in logs.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  // Must stay last: turns off the rules Prettier owns.
  prettier,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MaxOff:
    ".open-next/**",
    ".wrangler/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "supabase/migrations/**",
  ]),
]);

export default eslintConfig;
