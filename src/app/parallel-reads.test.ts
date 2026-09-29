import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The session read is not a gate (ARCHITECTURE §19, owner 2026-09-28): a page or layout that
 * awaits `requireMember()` / `requirePermission()` on its own and **then** awaits its data made
 * every screen wait one extra database round trip. This sweeps `src/app` for that shape: a
 * standalone `await require…()` followed by another `await` in the same file, with no reads
 * started before it (`startEarly(`, or the reads inside the same `Promise.all`).
 *
 * Awaiting `params` or `searchParams` is not a read. A page whose reads genuinely need the role
 * first says so on the line above with `perf: sequential` and why.
 */

const ESCAPE = "perf: sequential";
const STANDALONE = /^[ \t]+(?:const [^=\n]+= )?await require(?:Member|Permission)\(/gm;
const NOT_A_READ = /await (?:params|searchParams)\b/g;

export function findWaterfalls(text: string): number[] {
  const lines = text.split("\n");
  const found: number[] = [];
  for (const match of text.matchAll(STANDALONE)) {
    const line = text.slice(0, match.index).split("\n").length;
    if ((lines[line - 2] ?? "").includes(ESCAPE)) continue;
    if (text.slice(0, match.index).includes("startEarly(")) continue;
    const after = text.slice(match.index + match[0].length).replace(NOT_A_READ, "");
    if (/\bawait\b/.test(after)) found.push(line);
  }
  return found;
}

describe("the checker (fixtures)", () => {
  it("flags a session read that the page's reads wait behind", () => {
    const page = `export default async function Page() {
  const viewer = await requirePermission("team.view");
  const rows = await listRows(viewer.id);
}`;
    expect(findWaterfalls(page)).toEqual([2]);
  });

  it("passes parallel reads, early starts, a page with no reads and a marked one", () => {
    expect(
      findWaterfalls(`  const [viewer, rows] = await Promise.all([requireMember(), listRows()]);`),
    ).toEqual([]);
    expect(
      findWaterfalls(`  startEarly(read);\n  const viewer = await requireMember();\n  await read;`),
    ).toEqual([]);
    expect(findWaterfalls(`  await requirePermission("tasks.work");\n  return <Page />;`)).toEqual(
      [],
    );
    expect(
      findWaterfalls(
        `  // perf: sequential (the read is chosen by the role)\n  const v = await requireMember();\n  await x();`,
      ),
    ).toEqual([]);
  });
});

const root = fileURLToPath(new URL("./", import.meta.url));

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(child);
    return /^(page|layout)\.tsx$/.test(entry.name) ? [child] : [];
  });
}

describe("the routes", () => {
  const files = routeFiles(root).map((file) => ({
    path: path.relative(root, file).replaceAll("\\", "/"),
    text: readFileSync(file, "utf8"),
  }));

  it("finds the routes at all", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("never make a screen's reads wait behind the session read", () => {
    const violations = files.flatMap((file) =>
      findWaterfalls(file.text).map((line) => `src/app/${file.path}:${line}`),
    );
    expect(violations).toEqual([]);
  });
});
