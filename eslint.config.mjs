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
      // ADR-0008: business dates come from core/time, never from the wall clock.
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "Don't read the wall clock here. Use todayIST()/systemClock from @/core/time (ADR-0008).",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "Don't read the wall clock here. Use todayIST()/systemClock from @/core/time (ADR-0008).",
        },
      ],
    },
  },
  {
    // The one place that may read the clock. Tests build explicit instants instead.
    files: ["src/core/time/**"],
    rules: { "no-restricted-syntax": "off" },
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
