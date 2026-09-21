import { readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * Proves the architecture rules in `eslint.config.mjs` (ARCHITECTURE §3.1, ADR-0011,
 * CLAUDE.md rules 2 and 3). Each fixture under `tests/lint-fixtures/src` mirrors a real path,
 * so it is classified exactly like `src/`. `denied-*` files must trip the listed rules and
 * nothing else; every other fixture must lint clean. The folder is in ESLint's global ignores,
 * so `pnpm lint` never fails on it: only this test looks at it.
 */
const ROOT = process.cwd();
const FIXTURES = join(ROOT, "tests", "lint-fixtures", "src");

const BOUNDARIES = "boundaries/dependencies";
const IMPORTS = "@typescript-eslint/no-restricted-imports";
const GLOBALS = "no-restricted-globals";
const SYNTAX = "no-restricted-syntax";

const EXPECTED: Record<string, readonly string[]> = {
  // app (and files directly under src/) → core and module index.ts only
  "app/denied-module-internal.ts": [BOUNDARIES],
  "app/denied-module-permissions.ts": [BOUNDARIES],
  "app/denied-db.ts": [BOUNDARIES],
  "app/api/cron/denied-service.ts": [BOUNDARIES],
  "denied-root-db.ts": [BOUNDARIES],
  // core never imports modules; only the listed core areas hold a database client
  "core/ui/denied-module.ts": [BOUNDARIES],
  "core/errors/denied-db.ts": [BOUNDARIES],
  // modules reach each other through index.ts; only data/ touches the database
  "modules/tasks/denied-index-type-cross.ts": [BOUNDARIES],
  "modules/tasks/actions/denied-cross-internal.ts": [BOUNDARIES],
  "modules/tasks/actions/denied-db.ts": [BOUNDARIES],
  "modules/tasks/actions/denied-supabase.ts": [IMPORTS],
  "modules/tasks/tests/denied-cross-internal.ts": [BOUNDARIES],
  "modules/tasks/tests/denied-db.ts": [BOUNDARIES],
  // money relations are named only inside modules/revenue
  "modules/tasks/components/denied-money.ts": [SYNTAX],
  "modules/tasks/components/denied-money-template.ts": [SYNTAX],
  "modules/tasks/components/denied-money-embedded.ts": [SYNTAX],
  // domain is platform-free (ADR-0011)
  "modules/tasks/domain/denied-react.ts": [IMPORTS],
  "modules/tasks/domain/denied-next.ts": [IMPORTS],
  "modules/tasks/domain/denied-server-only.ts": [IMPORTS],
  "modules/tasks/domain/denied-supabase.ts": [IMPORTS],
  "modules/tasks/domain/denied-dom-global.ts": [GLOBALS],
  "modules/tasks/domain/denied-core-ui.ts": [BOUNDARIES],
  "modules/tasks/domain/denied-db.ts": [BOUNDARIES],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const toPosix = (path: string) => path.replaceAll("\\", "/");
const isDenied = (file: string) => basename(file).startsWith("denied-");

describe("architecture lint rules", async () => {
  const eslint = new ESLint({ cwd: ROOT, ignore: false });
  const results = await eslint.lintFiles(walk(FIXTURES));
  const byFile = new Map(
    results.map((r) => [
      toPosix(relative(FIXTURES, r.filePath)),
      r.messages.filter((m) => m.severity === 2).map((m) => m.ruleId ?? m.message),
    ]),
  );

  it("lints every fixture", () => {
    expect([...byFile.keys()].sort()).toEqual(
      walk(FIXTURES)
        .map((f) => toPosix(relative(FIXTURES, f)))
        .sort(),
    );
  });

  it("every denied fixture is listed in EXPECTED", () => {
    const denied = [...byFile.keys()].filter(isDenied).sort();
    expect(denied).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [file, rules] of Object.entries(EXPECTED)) {
    it(`${file} trips ${rules.join(" + ")}`, () => {
      expect([...new Set(byFile.get(file))].sort()).toEqual([...rules].sort());
    });
  }

  for (const file of [...byFile.keys()].filter((f) => !isDenied(f)).sort()) {
    it(`${file} is clean`, () => {
      expect(byFile.get(file)).toEqual([]);
    });
  }
});
