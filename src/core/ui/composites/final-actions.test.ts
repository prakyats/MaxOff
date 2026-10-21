import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Final, irreversible-looking actions are red (owner correction 2026-10-21, ADR-0015
 * consequences): a `ConfirmDialog` / `ReasonDialog` whose commit says Cancel project / task /
 * leave, Close deliverable, Reject, Revoke, Deactivate, Withdraw, Remove, Discard or Delete must
 * pass `destructive` (the red `danger` commit). Archive stays neutral ("archive never red"). This
 * sweeps every call site's opening tag by its commit label, so none can silently be neutral.
 */

const root = fileURLToPath(new URL("../../../../", import.meta.url));

const FINAL =
  /[`"](Cancel (project|task|leave)|Close deliverable|Reject|Revoke|Deactivate|Withdraw|Remove|Discard|Delete)\b/;
const ARCHIVE = /[`"]Archive\b/;
/** Positive final decisions: the Forest green `approve` (colour plan, owner 2026-10-21). */
const POSITIVE = /[`"](Approve|Mark (\$\{[^}]*\} )?done|Grant)\b/;

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) found.push(full);
  }
  return found;
}

/** The opening tag starting at `start`, braces and strings respected, up to its `>` or `/>`. */
function openingTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

type Site = {
  where: string;
  label: string;
  destructive: boolean;
  approve: boolean;
  cancelLabel: string | null;
};

function sites(): Site[] {
  const out: Site[] = [];
  for (const file of sources(path.join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/<(ConfirmDialog|ConfirmDialogLazy|ReasonDialog)\b/g)) {
      const tag = openingTag(text, match.index);
      const label = /(confirmLabel|submitLabel)=(\{[^\n]*|"[^"]*")/.exec(tag)?.[2] ?? "";
      out.push({
        where: `${path.relative(root, file)}:${text.slice(0, match.index).split("\n").length}`,
        label,
        destructive: /\sdestructive(\s|=|\/?>)/.test(tag),
        approve: /\sapprove(\s|=|\/?>)/.test(tag),
        cancelLabel: /cancelLabel=(\{[^\n]*|"[^"]*")/.exec(tag)?.[1] ?? null,
      });
    }
  }
  return out;
}

describe("final actions are red (owner 2026-10-21)", () => {
  const all = sites();

  it("finds the confirmation call sites at all", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it("gives every final commit (Cancel, Close, Reject, Revoke, Withdraw, Remove, Discard, Delete) the red danger", () => {
    const neutral = all.filter((site) => FINAL.test(site.label) && !site.destructive);
    expect(neutral.map((site) => `${site.where} ${site.label}`)).toEqual([]);
  });

  it("gives every positive final decision (Approve, Mark done, Grant) the Forest green approve", () => {
    const plain = all.filter((site) => POSITIVE.test(site.label) && !site.approve);
    expect(plain.map((site) => `${site.where} ${site.label}`)).toEqual([]);
  });

  it("never puts approve on a destructive commit", () => {
    const both = all.filter((site) => site.approve && site.destructive);
    expect(both.map((site) => `${site.where} ${site.label}`)).toEqual([]);
  });

  it("never dismisses a red Cancel … with a bare Cancel: the dismiss says what it keeps", () => {
    const bare = all.filter(
      (site) =>
        site.destructive &&
        /[`"]Cancel\b/.test(site.label) &&
        (site.cancelLabel === null || /^"Cancel"$/.test(site.cancelLabel)),
    );
    expect(bare.map((site) => `${site.where} ${site.label}`)).toEqual([]);
  });

  it("keeps Archive neutral (archive never red)", () => {
    const red = all.filter((site) => ARCHIVE.test(site.label) && site.destructive);
    expect(red.map((site) => `${site.where} ${site.label}`)).toEqual([]);
  });
});
