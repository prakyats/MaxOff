import boundaries from "eslint-plugin-boundaries";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Element patterns are suffix-matched, so `tests/lint-fixtures/src/**` is classified exactly like
// `src/**` and `tests/lint-rules.test.ts` can prove every rule below fires (and stays quiet).

/**
 * `core/` folders that own tables and may hold a database client. Everything else in `core/`
 * (ui, time, errors, lib, permissions, realtime, ...) is denied, like `app/` and every
 * module folder except `data/` (CLAUDE.md engineering rule 3).
 */
const DB_ALLOWED_CORE_AREAS = [
  "db",
  "auth",
  "activity",
  "lists",
  "custom-fields",
  "notifications",
  "storage",
];

/** The only `core/` areas a module's `domain/` may import: pure helpers with no platform tie (ADR-0011). */
const DOMAIN_ALLOWED_CORE_AREAS = ["time", "errors", "lib"];

/** DATA-MODEL §7: money tables and views. Only `modules/revenue` (and `core/db`'s generated types) may name them. */
const MONEY_RELATIONS =
  "project_billing|item_billing|cycle_billing|revenue_overrides|revenue_by_client_month_v|revenue_by_cycle_v";

const WALL_CLOCK_MESSAGE =
  "Don't read the wall clock here. Use todayIST()/systemClock from @/core/time (ADR-0008).";
const WALL_CLOCK_SELECTORS = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: WALL_CLOCK_MESSAGE,
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: WALL_CLOCK_MESSAGE,
  },
];

const MONEY_MESSAGE =
  "Money tables and views are read only through modules/revenue (CLAUDE.md invariant 2, ADR-0007).";
// Word-bounded, so `.from("project_billing")`, `Tables<"item_billing">` and an embedded
// select like "id, project_billing(amount)" all fail. Only string and template literals are
// checked; identifiers (`row.project_billing`) are not, and pgTAP proves RLS behind them.
const MONEY_PATTERN = `/(^|[^A-Za-z0-9_])(${MONEY_RELATIONS})([^A-Za-z0-9_]|$)/`;
const MONEY_SELECTORS = [
  { selector: `Literal[value=${MONEY_PATTERN}]`, message: MONEY_MESSAGE },
  { selector: `TemplateElement[value.raw=${MONEY_PATTERN}]`, message: MONEY_MESSAGE },
];

const BUTTON_COLOUR_MESSAGE =
  "Buttons get their colour from a variant (primary, destructive, secondary, ghost, strong), never from classes: the action colour rule, ARCHITECTURE §14.1.";
/**
 * The action colour rule's lint half (ARCHITECTURE §14.1): outside `core/ui/primitives`, a
 * `<Button>`, a `<button>` or `buttonVariants(...)` may not carry colour classes or hex values.
 * Checked in string and template literals anywhere inside `className` (including `cn(...)`).
 */
const BUTTON_COLOUR = String.raw`/(^|[\s:])(bg-(red-[0-9]+|black|white|brand|primary|destructive|strong|danger)|text-(white|black|red-[0-9]+|brand|primary-foreground)|border-(red-[0-9]+|brand|primary))([\s/]|$)|#[0-9a-fA-F]{3,8}/`;
const BUTTON_COLOUR_SELECTORS = [
  "JSXOpeningElement[name.name=/^(Button|button)$/] JSXAttribute[name.name='className'] Literal",
  "JSXOpeningElement[name.name=/^(Button|button)$/] JSXAttribute[name.name='className'] TemplateElement",
  "CallExpression[callee.name='buttonVariants'] Property[key.name='className'] Literal",
].map((scope) => ({
  selector: `${scope}[${scope.endsWith("TemplateElement") ? "value.raw" : "value"}=${BUTTON_COLOUR}]`,
  message: BUTTON_COLOUR_MESSAGE,
}));

const DB_MESSAGE =
  "Only data/ layers and the listed core/ areas touch the database (CLAUDE.md rule 3). Type imports are fine.";
/** The Supabase packages themselves. `core/db` imports are checked by the boundaries policy below. */
const DB_CLIENT_PACKAGES = {
  paths: ["@supabase/supabase-js", "@supabase/ssr"].map((name) => ({
    name,
    message: DB_MESSAGE,
    allowTypeImports: true,
  })),
};

const OVERLAY_MESSAGE =
  "Overlays come from @/core/ui/primitives (Sheet, Dialog, AlertDialog), whose roots register with the back-gesture controller (core/ui/overlay). Radix is imported only inside core/ui/primitives.";
/** Radix itself: reaching past our roots is the only way to get an overlay back ignores. */
const RADIX_IMPORTS = {
  paths: [{ name: "radix-ui", message: OVERLAY_MESSAGE }],
  patterns: [{ group: ["@radix-ui/*", "radix-ui/*"], message: OVERLAY_MESSAGE }],
};

/** ESLint replaces a rule's options per block, so every block that sets the rule merges these. */
function restrictedImports(...sets) {
  return {
    paths: sets.flatMap((set) => set.paths ?? []),
    patterns: sets.flatMap((set) => set.patterns ?? []),
  };
}

const PLATFORM_MESSAGE =
  "modules/*/domain is platform-free: no react, next, server-only or client-only (ADR-0011).";
// ESLint replaces rule options per block, so the domain block repeats the Supabase paths.
const PLATFORM_IMPORTS = {
  paths: [
    ...["react", "react-dom", "next", "server-only", "client-only"].map((name) => ({
      name,
      message: PLATFORM_MESSAGE,
    })),
    ...DB_CLIENT_PACKAGES.paths,
  ],
  patterns: [{ group: ["react/*", "react-dom/*", "next/*"], message: PLATFORM_MESSAGE }],
};

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "HTMLElement",
  "Element",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "DOMParser",
  "requestAnimationFrame",
  "alert",
  "confirm",
  "prompt",
].map((name) => ({
  name,
  message: "modules/*/domain is platform-free: no DOM globals (ADR-0011).",
}));

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
      "no-restricted-syntax": ["error", ...WALL_CLOCK_SELECTORS, ...BUTTON_COLOUR_SELECTORS],
    },
  },

  // ARCHITECTURE §3.1: app → modules (index.ts only) → core. Core never imports modules.
  {
    files: ["**/src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        // Most specific first: the first descriptor that matches a folder level wins.
        { type: "module-domain", pattern: "src/modules/*/domain", capture: ["module"] },
        { type: "module-data", pattern: "src/modules/*/data", capture: ["module"] },
        { type: "module-actions", pattern: "src/modules/*/actions", capture: ["module"] },
        { type: "module-components", pattern: "src/modules/*/components", capture: ["module"] },
        { type: "module-tests", pattern: "src/modules/*/tests", capture: ["module"] },
        { type: "module", pattern: "src/modules/*", capture: ["module"] },
        { type: "core", pattern: "src/core/*", capture: ["area"] },
        { type: "app", pattern: "src/app" },
        // Files directly under src/ (proxy.ts, instrumentation.ts) follow the app rules.
        { type: "root", pattern: "src" },
      ],
    },
    rules: {
      // Every file under src/ must belong to one of the elements above.
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message:
            "{{from.element.type}} may not import {{to.element.type}} here (ARCHITECTURE §3.1).",
          // The last matching policy wins, so the general ones come first.
          policies: [
            {
              from: { element: { type: ["app", "root"] } },
              allow: {
                to: [
                  { element: { type: "core" } },
                  { element: { type: "module", fileInternalPath: "index.ts" } },
                  // Client components one file at a time (ADR-0011 amendment, task 2.8): a
                  // barrel of client components is not tree-shaken per route. Only
                  // components/; data/, domain/ and actions/ stay behind index.ts.
                  // `tests/module-components.test.ts` holds these imports to "use client" files.
                  { element: { type: "module-components" } },
                ],
              },
            },
            {
              from: { element: { type: "core" } },
              allow: { to: { element: { type: "core" } } },
              message: "core never imports modules (ARCHITECTURE §3.1).",
            },
            {
              from: { element: { type: "module*" } },
              allow: {
                to: [
                  {
                    element: {
                      type: "module*",
                      captured: { module: "{{from.element.captured.module}}" },
                    },
                  },
                  { element: { type: "core" } },
                  { element: { type: "module", fileInternalPath: "index.ts" } },
                ],
              },
              message: "Another module is reachable only through its index.ts (ARCHITECTURE §3.1).",
            },
            // ADR-0011: domain is platform-free, so it sees only its own domain and pure core helpers.
            {
              from: { element: { type: "module-domain" } },
              disallow: { to: { element: { type: "*" } } },
              message:
                "modules/*/domain may import only its own domain and core/{time,errors,lib} (ADR-0011).",
            },
            {
              from: { element: { type: "module-domain" } },
              allow: {
                to: [
                  {
                    element: {
                      type: "module-domain",
                      captured: { module: "{{from.element.captured.module}}" },
                    },
                  },
                  { element: { type: "core", captured: { area: DOMAIN_ALLOWED_CORE_AREAS } } },
                ],
              },
            },
            // Generated row and enum types (`Tables<>`, `Enums<>`) are platform-free data shapes.
            {
              from: { element: { type: "module-domain" } },
              dependency: { kind: "type" },
              allow: { to: { element: { type: "core", captured: { area: "db" } } } },
            },
            // CLAUDE.md rule 3: a database client is held only by data/ layers and the core
            // areas that own tables. Type-only imports never touch the database, so they pass.
            {
              from: { element: { type: "*" } },
              dependency: { kind: "value" },
              disallow: { to: { element: { type: "core", captured: { area: "db" } } } },
              message: DB_MESSAGE,
            },
            {
              from: [
                { element: { type: "module-data" } },
                { element: { type: "core", captured: { area: DB_ALLOWED_CORE_AREAS } } },
              ],
              allow: { to: { element: { type: "core", captured: { area: "db" } } } },
            },
          ],
        },
      ],
    },
  },

  // CLAUDE.md rule 3: only data/ layers (and the core areas that own tables) touch the database.
  {
    files: ["**/src/**/*.{ts,tsx}"],
    ignores: [
      "**/src/modules/*/data/**",
      ...DB_ALLOWED_CORE_AREAS.map((area) => `**/src/core/${area}/**`),
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        restrictedImports(DB_CLIENT_PACKAGES, RADIX_IMPORTS),
      ],
    },
  },
  // The database areas above skip that block, but not the overlay rule.
  {
    files: [
      "**/src/modules/*/data/**/*.{ts,tsx}",
      ...DB_ALLOWED_CORE_AREAS.map((area) => `**/src/core/${area}/**/*.{ts,tsx}`),
    ],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", RADIX_IMPORTS] },
  },
  // Task 1.5 / the 2.3 fix: the primitives are where Radix is wrapped and registered.
  {
    files: ["**/src/core/ui/primitives/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", DB_CLIENT_PACKAGES] },
  },

  // ADR-0011: modules/*/domain must stay usable from a native app or a plain script.
  {
    files: ["**/src/modules/*/domain/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        restrictedImports(PLATFORM_IMPORTS, RADIX_IMPORTS),
      ],
      "no-restricted-globals": ["error", ...DOM_GLOBALS],
    },
  },

  // CLAUDE.md invariant 2: money is Owner-only and readable only through modules/revenue.
  {
    files: ["**/src/**/*.{ts,tsx}"],
    ignores: ["**/src/modules/revenue/**", "**/src/core/db/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...WALL_CLOCK_SELECTORS,
        ...MONEY_SELECTORS,
        ...BUTTON_COLOUR_SELECTORS,
      ],
    },
  },
  // The primitives are where button colours are defined (the variants themselves).
  {
    files: ["**/src/core/ui/primitives/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", ...WALL_CLOCK_SELECTORS, ...MONEY_SELECTORS] },
  },
  {
    // The one place that may read the clock. Tests build explicit instants instead.
    files: ["src/core/time/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  // The service worker is plain JS in public/ (no build step) and runs in a worker scope.
  {
    files: ["public/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        Response: "readonly",
        URL: "readonly",
        Promise: "readonly",
        console: "readonly",
      },
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
    // Deliberate violations, linted only by tests/lint-rules.test.ts.
    "tests/lint-fixtures/**",
    // Local design tooling (git-ignored), e.g. screenshot scripts.
    ".impeccable/**",
  ]),
]);

export default eslintConfig;
