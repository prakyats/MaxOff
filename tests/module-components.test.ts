import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ADR-0011 amendment (task 2.8): `app/` may import a module's **client** components one file at
 * a time (`@/modules/<m>/components/<file>`), because a barrel of client components ships all
 * of them to every route that imports it. The lint rule lets `app/` reach `components/`; this
 * test holds those imports to files that start with "use client", so server components,
 * data, domain and actions keep going through `index.ts`.
 */
const ROOT = process.cwd();
// Static `from "..."` and dynamic `import("...")` alike.
const IMPORT = /(?:from |import\()"@\/modules\/([^/"]+)\/components\/([^"]+)"/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

function source(module: string, file: string): string {
  for (const ext of [".tsx", ".ts"]) {
    try {
      return readFileSync(join(ROOT, "src", "modules", module, "components", file + ext), "utf8");
    } catch {
      // try the next extension
    }
  }
  throw new Error(`@/modules/${module}/components/${file} does not exist`);
}

describe("per-file module component imports (ADR-0011 amendment)", () => {
  const files = [
    ...walk(join(ROOT, "src", "app")),
    ...readdirSync(join(ROOT, "src"))
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => join(ROOT, "src", name)),
  ];
  const imports = files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(IMPORT)].map(([, module, target]) => ({
      file,
      module: module!,
      target: target!,
    })),
  );

  it("finds the imports it checks", () => {
    expect(imports.length).toBeGreaterThan(0);
  });

  it.each(imports.map((i) => [`${i.module}/components/${i.target}`, i] as const))(
    "%s is a client component",
    (_, { module, target }) => {
      expect(source(module, target).trimStart().startsWith('"use client"')).toBe(true);
    },
  );
});
