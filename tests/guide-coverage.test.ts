import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { can, type MemberRole, type PermissionKey } from "@/core/permissions";
import { guideFor } from "@/modules/guide/domain/guide";

/**
 * Every screen, for every role that opens it, has a guide topic (v8.0 "finish the user guide"; owner
 * 2026-10-15: "it should be up-to-date, so I can tell the team to refer to it").
 *
 * - **The screens:** every `page.tsx` under `src/app/(app)`, route groups dropped.
 * - **Who opens one:** the keys of the `requirePermission(…)` that guards it, in the page or the
 *   nearest `layout.tsx` above it (`requireMember()`: every role), mapped through `can()`.
 * - **Covered:** a topic of that role's guide links to the route (`link.href`, query dropped; a
 *   `[segment]` matches any value).
 *
 * The gaps today are pinned in `KNOWN_GAPS` (v8.0 work, `docs/handoff/v8.0-plan.md` §2), so the
 * test stays green while it fails on a **new** screen without a topic, and on a gap that has
 * been closed but is still listed. v8.0 empties the list.
 */

const APP = path.join(process.cwd(), "src/app/(app)");
const ROLES: readonly MemberRole[] = ["owner", "admin", "staff"];

/** Routes that explain themselves or carry nothing to guide, each with its reason. */
const NOT_GUIDED: Record<string, string> = {
  "/forbidden": "the no-access page: it says what to do itself",
  "/open": "a redirect for notification links: it never draws a screen",
  "/me/guide": "the guide itself",
  "/settings/stage-presets": "a redirect to Settings → Templates (6b.6)",
};

const CLIENT_LEADS: readonly MemberRole[] = ["owner", "admin"];

/**
 * Who opens a screen whose real gate is not a `requirePermission` in the page or a layout: a shared
 * loader's (a client's pages: `clients/[id]/client.ts`; a person's history tabs: `person.ts`'s
 * `loadHistoryPerson`, `attendance.view_all`) or a role redirect (Today sends the Crew to My Day).
 */
const AUDIENCE: Record<string, readonly MemberRole[]> = {
  "/clients/[id]": CLIENT_LEADS,
  "/clients/[id]/activity": CLIENT_LEADS,
  "/clients/[id]/brand": CLIENT_LEADS,
  "/clients/[id]/contacts/[contactId]": CLIENT_LEADS,
  "/clients/[id]/projects": CLIENT_LEADS,
  "/clients/[id]/projects/[projectId]": CLIENT_LEADS,
  "/people/[id]/attendance": ["owner"],
  "/people/[id]/leave": ["owner"],
  "/people/[id]/month": ["owner"],
  "/today": CLIENT_LEADS,
};

/**
 * The gaps on 26 Nov 2026 (main 3d237d0): role → routes no topic of theirs links to. Some are tabs a
 * parent topic describes without a link of its own (a client's Brand tab); the v8.0 audit decides
 * each one: a link on the topic that describes it, or a new topic.
 */
const KNOWN_GAPS: Record<MemberRole, readonly string[]> = {
  owner: [
    "/clients/[id]/activity",
    "/clients/[id]/brand",
    "/clients/[id]/contacts/[contactId]",
    "/clients/[id]/projects",
    "/clients/[id]/projects/[projectId]",
    "/people/[id]",
    "/people/[id]/attendance",
    "/people/[id]/leave",
    "/people/[id]/month",
    "/reports",
    // v3.5: a month's close screen needs the month in its path; "Close a month" reaches it from the
    // Revenue page's month header (its link is "Open Revenue"), so no fixed link can name it.
    "/reports/close/[month]",
    "/reports/end-of-day/[date]",
    "/settings/company",
  ],
  admin: [
    "/clients/[id]/activity",
    "/clients/[id]/brand",
    "/clients/[id]/contacts/[contactId]",
    "/clients/[id]/projects",
    "/clients/[id]/projects/[projectId]",
    "/leave/expenses",
    "/my-day",
    "/people/[id]",
    "/settings/custom-fields",
  ],
  staff: ["/tasks/all"],
};

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

function routeOf(file: string): string {
  const rel = path.relative(APP, path.dirname(file)).split(path.sep);
  const parts = rel.filter((part) => part !== "" && !/^\(.*\)$/.test(part));
  return `/${parts.join("/")}`;
}

type Guard = { kind: "member" } | { kind: "keys"; keys: PermissionKey[] } | null;

function guardIn(file: string): Guard {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const call = /requirePermission\(\s*(\[[^\]]*\]|"[^"]+")/m.exec(text);
  if (call?.[1]) {
    const keys = [...call[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as PermissionKey);
    return { kind: "keys", keys };
  }
  if (/requireMember\(/.test(text)) return { kind: "member" };
  return null;
}

/** The page's own guard, else the nearest layout's above it. */
function guardOf(file: string): Guard {
  const own = guardIn(file);
  if (own) return own;
  let dir = path.dirname(file);
  while (dir.startsWith(APP)) {
    const layout = guardIn(path.join(dir, "layout.tsx"));
    if (layout) return layout;
    dir = path.dirname(dir);
  }
  return null;
}

function rolesFor(guard: Guard): MemberRole[] {
  if (!guard) return [];
  if (guard.kind === "member") return [...ROLES];
  return ROLES.filter((role) => can(role, guard.keys));
}

/** "/clients/[id]/brand" matches "/clients/abc/brand". */
function matches(route: string, href: string): boolean {
  const target = href.split(/[?#]/)[0] ?? "";
  const pattern = new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}$`);
  return pattern.test(target);
}

function linksOf(role: MemberRole): string[] {
  return guideFor(role).sections.flatMap((section) =>
    section.topics.flatMap((topic) => (topic.link ? [topic.link.href] : [])),
  );
}

export function guideGaps(): Record<MemberRole, string[]> {
  const gaps: Record<MemberRole, string[]> = { owner: [], admin: [], staff: [] };
  for (const file of pages(APP)) {
    const route = routeOf(file);
    if (route in NOT_GUIDED) continue;
    for (const role of AUDIENCE[route] ?? rolesFor(guardOf(file))) {
      if (!linksOf(role).some((href) => matches(route, href))) gaps[role].push(route);
    }
  }
  for (const role of ROLES) gaps[role].sort();
  return gaps;
}

describe("the guide covers every screen for every role that opens it", () => {
  it("every page has a guard the test can read (so no screen escapes the check)", () => {
    const unguarded = pages(APP)
      .filter((file) => !(routeOf(file) in NOT_GUIDED))
      .filter((file) => guardOf(file) === null)
      .map(routeOf);
    expect(unguarded).toEqual([]);
  });

  for (const role of ROLES) {
    it(`${role}: the screens without a topic are exactly the known gaps`, () => {
      expect(guideGaps()[role]).toEqual([...KNOWN_GAPS[role]].sort());
    });
  }
});
