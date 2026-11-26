import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every migration has its own version (advisor, 26 Nov 2026, #89). Supabase records a migration by the
 * 14-digit version before its first `_`, not by its file name: two files with one version are one
 * migration to it. v2.5's 20261125160000 / 20261125170000 shared their versions with v7.0's, staging
 * recorded v7.0's first and never applied v2.5's, and on `main` the pair would break `db reset` and every
 * migration push. This test fails the check job (and `pnpm check`) as soon as a merge brings two files
 * with one version into the tree.
 */
const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

describe("supabase/migrations", () => {
  it("names every file <14-digit version>_<name>.sql", () => {
    expect(files.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name))).toEqual([]);
  });

  it("gives every migration a version no other file has", () => {
    const byVersion = new Map<string, string[]>();
    for (const name of files) {
      const version = name.slice(0, 14);
      byVersion.set(version, [...(byVersion.get(version) ?? []), name]);
    }
    const clashes = [...byVersion.values()].filter((names) => names.length > 1);
    expect(clashes).toEqual([]);
  });
});
