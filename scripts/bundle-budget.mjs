// First-load JS per route, from the last `next build`, against `bundle-budget.json` (task 2.8).
//
//   node scripts/bundle-budget.mjs          check the budgeted routes; exit 1 when one is over
//   node scripts/bundle-budget.mjs --all    print every page's first load, check nothing
//
// Sizes are decompressed bytes (what the phone parses and runs); gzip is printed beside them.
// Runs after `pnpm build` in `pnpm check` and after `pnpm build:worker` in CI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { checkBudgets, firstLoadFiles } from "./lib/first-load.mjs";

const NEXT = ".next";
const budgets = JSON.parse(readFileSync("bundle-budget.json", "utf8")).routes ?? {};
if (Object.keys(budgets).length === 0) {
  console.error("✗ bundle-budget.json budgets no route: the check would prove nothing");
  process.exit(1);
}
const { rootMainFiles } = JSON.parse(readFileSync(join(NEXT, "build-manifest.json"), "utf8"));
const pages = JSON.parse(readFileSync(join(NEXT, "app-path-routes-manifest.json"), "utf8"));

/** The client reference manifest is a script that assigns `globalThis.__RSC_MANIFEST[page]`. */
function entryJSFiles(page) {
  const file = join(NEXT, "server", "app", `${page}_client-reference-manifest.js`);
  const sandbox = { __RSC_MANIFEST: {} };
  new Function("globalThis", "self", readFileSync(file, "utf8"))(sandbox, sandbox);
  return sandbox.__RSC_MANIFEST[page].entryJSFiles;
}

const sizes = new Map();
function size(file) {
  if (!sizes.has(file)) {
    const bytes = readFileSync(join(NEXT, file));
    sizes.set(file, { raw: bytes.length, gzip: gzipSync(bytes).length });
  }
  return sizes.get(file);
}

const all = process.argv.includes("--all");
const routes = Object.entries(pages)
  .filter(([page]) => page.endsWith("/page"))
  .filter(([, route]) => all || route in budgets);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const measured = {};
for (const [page, route] of routes) {
  const files = firstLoadFiles({ rootMainFiles, entryJSFiles: entryJSFiles(page) });
  const raw = files.reduce((sum, file) => sum + size(file).raw, 0);
  const gzip = files.reduce((sum, file) => sum + size(file).gzip, 0);
  measured[route] = raw;
  console.warn(
    `${route.padEnd(28)} ${String(files.length).padStart(3)} files  ${kb(raw).padStart(10)}  (gzip ${kb(gzip)})`,
  );
}

if (!all) {
  const results = checkBudgets(measured, budgets);
  for (const { route, bytes, budget, ok } of results) {
    if (!ok) {
      console.error(
        bytes === undefined
          ? `✗ ${route}: no such page in the build; update bundle-budget.json`
          : `✗ ${route}: ${kb(bytes)} is over its budget of ${kb(budget)}`,
      );
    }
  }
  if (results.some((result) => !result.ok)) process.exit(1);
  console.warn("✓ every budgeted route is within its first-load JS budget");
}
