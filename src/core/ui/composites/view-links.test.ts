import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * In-page view controls never add history (ARCHITECTURE §14.1, the 2.3 back-gesture fix).
 *
 * A tab, pager, month switcher or filter changes the query string of the page you are on. It
 * may keep the URL in sync, but with `replace`, so one back always leaves the page. The shared
 * way is `ViewLink`; a router call uses `router.replace`; a client redirect passes
 * `RedirectType.replace`. This sweeps the source for the ways to get it wrong, the same approach
 * as `loading-routes.test.ts` and `overlay-registration.test.ts`:
 *
 * 1. a `<Link>` whose `href` builds a query string;
 * 2. an `href: "…?key=…"` property in a file that renders `<Link>` (a tab or pager array);
 * 3. `router.push(…)` with a query string;
 * 4. `redirect(…)` with a query string in a client component, without `RedirectType.replace`.
 *
 * A link with a query that genuinely goes to **another** page (e.g. `/login?next=…`) is fine:
 * mark the line (or the one above it) with `view-link: navigation` and say why.
 *
 * Limits, on purpose: this reads source text, not types, so a query URL built in one file and
 * handed to a `<Link>` in another is not seen. Build such URLs next to the `ViewLink` that uses
 * them, as /leave does.
 */

const QUERY = /\?[A-Za-z_][\w-]*=|\?\$\{/;
const ESCAPE = "view-link: navigation";

export type Violation = { line: number; rule: string; text: string };

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function escaped(lines: string[], line: number): boolean {
  return (lines[line - 1] ?? "").includes(ESCAPE) || (lines[line - 2] ?? "").includes(ESCAPE);
}

/** Every way `text` adds history for a same-page view change. Exported for the fixtures below. */
export function findViewLinkViolations(text: string): Violation[] {
  const lines = text.split("\n");
  const found: Violation[] = [];
  const add = (index: number, rule: string, snippet: string) => {
    const line = lineOf(text, index);
    if (!escaped(lines, line)) found.push({ line, rule, text: snippet.trim().slice(0, 120) });
  };

  // 1. <Link ... href={...?key=...} or href="...?key=...">
  for (const match of text.matchAll(/<Link\b[\s\S]*?href=(\{[^}]*\}|"[^"]*"|'[^']*')/g)) {
    if (QUERY.test(match[1] ?? "")) add(match.index, "link-with-query", match[0]);
  }

  // 2. A tab or pager array feeding <Link>: `href: "/x?tab=…"`.
  if (/<Link\b/.test(text)) {
    for (const match of text.matchAll(/\bhref:\s*(`[^`]*`|"[^"]*"|'[^']*')/g)) {
      if (QUERY.test(match[1] ?? "")) add(match.index, "href-array-with-query", match[0]);
    }
  }

  // 3. router.push(…?key=…)
  for (const match of text.matchAll(/\brouter\.push\(([^)]*)\)/g)) {
    if (QUERY.test(match[1] ?? "")) add(match.index, "router-push-with-query", match[0]);
  }

  // 4. A client component's redirect(…?key=…) pushes unless told to replace.
  if (/^\s*["']use client["']/m.test(text)) {
    for (const match of text.matchAll(/\bredirect\(([^)]*)\)/g)) {
      const args = match[1] ?? "";
      if (QUERY.test(args) && !args.includes("RedirectType.replace")) {
        add(match.index, "client-redirect-with-query", match[0]);
      }
    }
  }
  return found;
}

describe("the checker (fixtures)", () => {
  it("flags a Link that builds a query string", () => {
    expect(
      findViewLinkViolations(`<Link href={\`/leave?page=\${page + 1}\`}>Older</Link>`),
    ).toMatchObject([{ rule: "link-with-query" }]);
    expect(
      findViewLinkViolations(`<Link\n  href="/leave?tab=attendance"\n>Tab</Link>`),
    ).toMatchObject([{ rule: "link-with-query", line: 1 }]);
  });

  it("flags a tab array that feeds a Link", () => {
    const source = `const TABS = [{ href: "/leave?tab=attendance" }];\n<Link href={tab.href} />`;
    expect(findViewLinkViolations(source)).toMatchObject([{ rule: "href-array-with-query" }]);
  });

  it("flags router.push with a query string", () => {
    expect(findViewLinkViolations("router.push(`${pathname}?month=${m}`);")).toMatchObject([
      { rule: "router-push-with-query" },
    ]);
  });

  it("flags a client redirect with a query string unless it replaces", () => {
    const client = `"use client";\nredirect("/leave?page=1");`;
    expect(findViewLinkViolations(client)).toMatchObject([
      { rule: "client-redirect-with-query", line: 2 },
    ]);
    expect(
      findViewLinkViolations(`"use client";\nredirect("/leave?page=1", RedirectType.replace);`),
    ).toEqual([]);
    // A server component's redirect answers a request; it does not stack client history.
    expect(findViewLinkViolations(`redirect("/leave?page=1");`)).toEqual([]);
  });

  it("passes a tab array that feeds ViewLink", () => {
    const source = `const TABS = [{ href: "/leave?tab=attendance" }];
<ViewLink href={tab.href} />`;
    expect(findViewLinkViolations(source)).toEqual([]);
  });

  it("passes ViewLink, router.replace, plain links and marked navigation", () => {
    expect(
      findViewLinkViolations(
        [
          `<ViewLink href={\`/leave?page=\${page}\`}>Older</ViewLink>`,
          "router.replace(`${pathname}?month=${m}`);",
          `<Link href="/leave">Attendance & leave</Link>`,
          `// view-link: navigation (another page)`,
          `<Link href="/login?reason=signed_out">Sign in</Link>`,
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

const root = fileURLToPath(new URL("../../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

describe("the source", () => {
  const files = sourceFiles(path.join(root, "src")).map((file) => ({
    path: path.relative(root, file).replaceAll("\\", "/"),
    text: readFileSync(file, "utf8"),
  }));

  it("finds the source at all, including the view controls it guards", () => {
    expect(files.length).toBeGreaterThan(50);
    const leaveNav = files.find((file) => file.path.endsWith("leave/leave-nav.tsx"));
    expect(leaveNav?.text).toContain("<ViewLink");
  });

  it("never adds history for a same-page view change", () => {
    const violations = files.flatMap((file) =>
      findViewLinkViolations(file.text).map((v) => `${file.path}:${v.line} ${v.rule}: ${v.text}`),
    );
    expect(violations).toEqual([]);
  });
});
