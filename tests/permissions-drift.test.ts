import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MEMBER_ROLES, type MemberRole, PERMISSION_KEYS, ROLE_GRANTS } from "@/core/permissions";

/**
 * The permission seed is the one thing nobody notices is wrong until phase 4. Three copies
 * exist on purpose (the doc people read, the registry the UI uses, the rows the database
 * enforces), so this test fails the moment any one of them drifts.
 *
 * Grants live in the 1.1 migration. A later migration that changes `role_permissions` must
 * also change PERMISSIONS.md and `ROLE_GRANTS`, and be added to `MIGRATIONS` here.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = ["supabase/migrations/20260922103634_team_identity.sql"];

type Grants = Record<MemberRole, string[]>;

function emptyGrants(): Grants {
  return { ceo: [], admin: [], staff: [] };
}

function sorted(grants: Grants): Grants {
  return {
    ceo: [...grants.ceo].sort(),
    admin: [...grants.admin].sort(),
    staff: [...grants.staff].sort(),
  };
}

/** The §1 table of docs/PERMISSIONS.md: `| \`key\` | what | CEO | Admin | Staff |`. */
function grantsFromDoc(): { keys: string[]; grants: Grants } {
  const doc = readFileSync(`${root}docs/PERMISSIONS.md`, "utf8");
  const section = doc.split("## 1. Permission keys and default grants")[1]?.split("\n## ")[0];
  if (!section) throw new Error("PERMISSIONS.md §1 not found");

  const keys: string[] = [];
  const grants = emptyGrants();
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const rowKeys = [...(cells[1] ?? "").matchAll(/`([a-z_.]+)`/g)].map((m) => m[1] as string);
    // A grant is a cell that starts with the mark ("✅ ¹", "✅ (everyone)"); a note that only
    // mentions it elsewhere is scope, not a grant.
    const marks: Record<MemberRole, boolean> = {
      ceo: (cells[3] ?? "").startsWith("✅"),
      admin: (cells[4] ?? "").startsWith("✅"),
      staff: (cells[5] ?? "").startsWith("✅"),
    };
    for (const key of rowKeys) {
      keys.push(key);
      for (const role of MEMBER_ROLES) if (marks[role]) grants[role].push(key);
    }
  }
  return { keys, grants };
}

/** Every `('role', 'key')` value in the seed insert(s). */
function grantsFromMigrations(): Grants {
  const grants = emptyGrants();
  for (const file of MIGRATIONS) {
    const sql = readFileSync(`${root}${file}`, "utf8");
    const insert = sql.split("insert into public.role_permissions")[1];
    if (!insert) throw new Error(`${file} has no role_permissions seed`);
    for (const match of insert.matchAll(/\('(ceo|admin|staff)',\s*'([a-z_.]+)'\)/g)) {
      grants[match[1] as MemberRole].push(match[2] as string);
    }
  }
  return grants;
}

describe("permission grants do not drift", () => {
  const doc = grantsFromDoc();
  const migration = grantsFromMigrations();

  it("PERMISSIONS.md §1 lists exactly the registry's keys, in order", () => {
    expect(doc.keys).toEqual([...PERMISSION_KEYS]);
  });

  it("PERMISSIONS.md §1 grants equal ROLE_GRANTS", () => {
    expect(sorted(doc.grants)).toEqual(sorted(ROLE_GRANTS as Grants));
  });

  it("the migration seed equals ROLE_GRANTS", () => {
    expect(sorted(migration)).toEqual(sorted(ROLE_GRANTS as Grants));
  });

  it("the seed has no duplicate rows", () => {
    for (const role of MEMBER_ROLES) {
      expect(new Set(migration[role]).size).toBe(migration[role].length);
    }
  });
});
