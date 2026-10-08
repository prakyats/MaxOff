import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The server sets no Sentry user (phase 6 review, 2026-10-08; ARCHITECTURE §18.2). On the Worker
 * nothing forks Sentry's isolation scope per request, so a `Sentry.setUser` in a server action, a
 * render or the Worker entry would tag every later server event in that isolate with that member.
 * Only the browser's reporter may call `setUser`: `early.ts` (the queue before the SDK loads, which
 * hands the id to the browser SDK) and `client.ts` (`setClientSentryUser`, called by
 * `<SentryUser>` in the signed-in shell). Every other call in `src/` (the instrumentation files
 * included) or `worker/` fails this sweep.
 */
const ROOT = process.cwd();
const BROWSER_REPORTER = ["src/core/observability/client.ts", "src/core/observability/early.ts"];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "tests" ? [] : walk(path);
    return /\.(?:[cm]?js|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every `setUser(...)` call in a file, by line: `Sentry.setUser(`, `sdk?.setUser(`, `setUser(`. */
function setUserCalls(path: string): number[] {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name === "setUser") {
        lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "worker"))].map((path) => ({
  path,
  file: relative(ROOT, path).split(sep).join("/"),
}));

describe("the Sentry user is set in the browser only", () => {
  it("finds the browser reporter's own calls (the sweep sees what it looks for)", () => {
    for (const file of BROWSER_REPORTER) {
      expect(setUserCalls(join(ROOT, file)).length, file).toBeGreaterThan(0);
    }
  });

  it("no server code, Worker entry or instrumentation calls setUser", () => {
    const found = files
      .filter(({ file }) => !BROWSER_REPORTER.includes(file))
      .flatMap(({ path, file }) => setUserCalls(path).map((line) => `${file}:${line}`));
    expect(found).toEqual([]);
  });
});
