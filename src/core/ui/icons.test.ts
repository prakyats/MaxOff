import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ICONS } from "./icons";

/**
 * One icon per concept (v1.8 consistency sweep, owner 2026-10-21; docs/DESIGN.md "Patterns"):
 * the map in `icons.ts` is the only source for History, Edit, Archive, Remind, Approve, Add, More
 * and Open. This guard fails on the synonyms a screen could otherwise pick (an ellipsis or a
 * vertical ⋮ for More, a pen for Edit, a ringing bell for Remind) and on History's clock imported
 * anywhere but the map.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));

const SYNONYMS = [
  "EllipsisIcon",
  "EllipsisVerticalIcon",
  "MoreVerticalIcon",
  "Edit2Icon",
  "Edit3Icon",
  "SquarePenIcon",
  "PenIcon",
  "PenLineIcon",
];

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

function lucideImports(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"lucide-react"/g)) {
    names.push(
      ...(match[1] ?? "")
        .split(",")
        .map((name) => name.trim().replace(/^type\s+/, ""))
        .filter(Boolean),
    );
  }
  return names;
}

describe("one icon per concept (icons.ts)", () => {
  const files = sources(root).map((file) => ({
    where: path.relative(root, file),
    names: lucideImports(readFileSync(file, "utf8")),
  }));

  it("maps the eight concepts", () => {
    expect(Object.keys(ICONS).sort()).toEqual(
      ["add", "approve", "archive", "edit", "history", "more", "open", "remind"].sort(),
    );
  });

  it("finds the icon imports at all", () => {
    expect(files.filter((file) => file.names.length > 0).length).toBeGreaterThan(50);
  });

  it("never uses a synonym for More or Edit", () => {
    const bad = files.flatMap((file) =>
      file.names.filter((name) => SYNONYMS.includes(name)).map((name) => `${file.where} ${name}`),
    );
    expect(bad).toEqual([]);
  });

  it("takes History's clock and Remind's bell from the map only", () => {
    const bad = files
      .filter((file) => file.where !== "core/ui/icons.ts")
      .flatMap((file) =>
        file.names
          .filter(
            (name) =>
              name === "HistoryIcon" || (name === "BellRingIcon" && /remind/i.test(file.where)),
          )
          .map((name) => `${file.where} ${name}`),
      );
    expect(bad).toEqual([]);
  });
});
