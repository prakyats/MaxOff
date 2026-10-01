import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The third role is shown as "Crew" (owner decision 2026-09-30); underneath it is still `staff`
 * (CLAUDE.md invariant 1). The display name is written once, in `src/core/lib/role-labels.ts`,
 * and every screen reads it from there. This sweep holds both halves: no text a person can read
 * in `src/` says "Staff", and none spells "Crew" out instead of reading the map.
 *
 * Text a person can read = string literals, template literals and JSX text. Comments,
 * identifiers, import paths and types are code, and so is a literal that is only the database
 * value or a key built from it (`"staff"`, `"role.eq.staff"`).
 */
const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const LABELS = "src/core/lib/role-labels.ts";
/** Generated from the database (`pnpm db:types`): the enum's values, never shown. */
const GENERATED = "src/core/db/database.types.ts";

const OLD_NAME = /\bstaff\b/i;
const NEW_NAME = /\bcrew\b/i;
/** The database value and keys built from it: lower case, no spaces. */
const IDENTIFIER = /^[a-z0-9_.:@/=-]+$/;

type Found = { file: string; line: number; text: string };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "tests" ? [] : walk(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function isReadableText(node: ts.Node): node is ts.LiteralLikeNode {
  if (ts.isJsxText(node)) return true;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return true;
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return false;
  const parent = node.parent;
  return !(
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isLiteralTypeNode(parent)
  );
}

function readableText(path: string): Found[] {
  const file = relative(ROOT, path).split(sep).join("/");
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Found[] = [];
  const visit = (node: ts.Node) => {
    if (isReadableText(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      found.push({ file, line, text: node.text.trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const where = (found: Found[]) => found.map(({ file, line, text }) => `${file}:${line} ${text}`);

describe('the third role is shown as "Crew", from one place', () => {
  const texts = walk(SRC)
    .flatMap(readableText)
    .filter(({ file }) => file !== GENERATED);

  it("reads the text of every source file", () => {
    expect(texts.length).toBeGreaterThan(1000);
    expect(texts.some(({ file }) => file === LABELS)).toBe(true);
  });

  it('shows no "Staff" to anyone', () => {
    const old = texts.filter(({ text }) => OLD_NAME.test(text) && !IDENTIFIER.test(text));
    expect(where(old)).toEqual([]);
  });

  it('spells "Crew" only in the role-label map', () => {
    const spelled = texts.filter(({ file, text }) => file !== LABELS && NEW_NAME.test(text));
    expect(where(spelled)).toEqual([]);
  });

  it("names no role in the emails Supabase sends", () => {
    const templates = join(ROOT, "supabase", "templates");
    const named = readdirSync(templates).filter((name) =>
      /\b(staff|crew)\b/i.test(readFileSync(join(templates, name), "utf8")),
    );
    expect(named).toEqual([]);
  });
});
