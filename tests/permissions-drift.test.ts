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
 * also change PERMISSIONS.md and `ROLE_GRANTS`, and be added to `MIGRATIONS` here. A migration
 * that renames an enum value (`alter type public.member_role rename value 'a' to 'b'`) is
 * applied to the seed text too, so applied migrations keep their original wording.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = [
  "supabase/migrations/20260922103634_team_identity.sql",
  "supabase/migrations/20260922130118_team_owner_role.sql",
];

type Grants = Record<MemberRole, string[]>;

function emptyGrants(): Grants {
  return { owner: [], admin: [], staff: [] };
}

function sorted(grants: Grants): Grants {
  return {
    owner: [...grants.owner].sort(),
    admin: [...grants.admin].sort(),
    staff: [...grants.staff].sort(),
  };
}

function isMemberRole(value: string): value is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(value);
}

/** The §1 table of docs/PERMISSIONS.md: `| \`key\` | what | Owner | Admin | Staff |`. */
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
      owner: (cells[3] ?? "").startsWith("✅"),
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

/** Every `('role', 'key')` value in the seed insert(s), with later enum renames applied. */
function grantsFromMigrations(): Grants {
  const seeds: Array<[role: string, key: string]> = [];
  const renames = new Map<string, string>();
  let seeded = false;
  for (const file of MIGRATIONS) {
    const sql = readFileSync(`${root}${file}`, "utf8");
    const insert = sql.split("insert into public.role_permissions")[1];
    if (insert) {
      seeded = true;
      for (const match of insert.matchAll(/\('([a-z_]+)',\s*'([a-z_.]+)'\)/g)) {
        seeds.push([match[1] as string, match[2] as string]);
      }
    }
    for (const match of sql.matchAll(
      /alter type public\.member_role rename value '([a-z_]+)' to '([a-z_]+)'/g,
    )) {
      renames.set(match[1] as string, match[2] as string);
    }
  }
  if (!seeded) throw new Error("no migration in MIGRATIONS seeds role_permissions");

  const grants = emptyGrants();
  for (const [seededRole, key] of seeds) {
    const role = renames.get(seededRole) ?? seededRole;
    if (!isMemberRole(role)) throw new Error(`seed row for unknown role '${role}'`);
    grants[role].push(key);
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

  it("the seed's original role names were renamed, not left behind", () => {
    // The 1.1 seed says 'ceo'; without the rename migration it would not map to a role.
    expect(Object.keys(migration)).toEqual([...MEMBER_ROLES]);
    expect(migration.owner.length).toBeGreaterThan(0);
  });
});
