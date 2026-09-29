import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every button that saves or changes something shows it is working (ARCHITECTURE §14.1, owner
 * 2026-09-28): a spinner, a working label ("Saving…"), disabled so a second tap does nothing.
 * Built once in `Button` (`pending`, `pendingLabel`) and `useAction`; this sweeps the source for
 * a commit button that does not take part: a `<Button>` that is `variant="primary"` (the commit
 * colour) or `type="submit"` without both `pending=` and `pendingLabel=`.
 *
 * A primary button that commits nothing itself (it opens a form or a confirmation whose own
 * button commits) is marked on its line or the one above with `pending: none` and a reason.
 * `ConfirmDialog` and `ReasonDialog` derive the label from the action's name (`workingLabel`).
 */

const ESCAPE = "pending: none";

export type Violation = { line: number; text: string };

function openingTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    // A comment between attributes (`// a bare <button> …`) is skipped to its end.
    if (char === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

export function findPendingViolations(text: string): Violation[] {
  const lines = text.split("\n");
  const found: Violation[] = [];
  for (const match of text.matchAll(/<Button(?=[\s>])/g)) {
    const tag = openingTag(text, match.index);
    const commits = /variant="primary"/.test(tag) || /type="submit"/.test(tag);
    if (!commits) continue;
    if (/\bpending=/.test(tag) && /\bpendingLabel=/.test(tag)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    const marked = [line - 1, line - 2].some((n) => (lines[n] ?? "").includes(ESCAPE));
    if (!marked) found.push({ line, text: tag.replace(/\s+/g, " ").slice(0, 120) });
  }
  return found;
}

describe("the checker (fixtures)", () => {
  it("flags a primary or submit button without its pending state", () => {
    expect(findPendingViolations(`<Button variant="primary" onClick={save}>Save</Button>`)).toEqual(
      [expect.objectContaining({ line: 1 })],
    );
    expect(
      findPendingViolations(`<Button type="submit" pending={pending}>Save</Button>`),
    ).toHaveLength(1);
  });

  it("passes a button with both, other variants, and a marked trigger", () => {
    expect(
      findPendingViolations(
        [
          `<Button variant="primary" pending={action.pending} pendingLabel="Saving…">Save</Button>`,
          `<Button variant="secondary" onClick={close}>Cancel</Button>`,
          `// pending: none (opens the form; its Save commits)`,
          `<Button variant="primary" onClick={() => setOpen(true)}>Request leave</Button>`,
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
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [child] : [];
  });
}

describe("the source", () => {
  const files = sourceFiles(path.join(root, "src"))
    .map((file) => ({
      path: path.relative(root, file).replaceAll("\\", "/"),
      text: readFileSync(file, "utf8"),
    }))
    .filter((file) => !file.path.startsWith("src/core/ui/primitives/"));

  it("finds the source at all", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("gives every commit button its pending state and working label", () => {
    const violations = files.flatMap((file) =>
      findPendingViolations(file.text).map((v) => `${file.path}:${v.line} ${v.text}`),
    );
    expect(violations).toEqual([]);
  });
});
