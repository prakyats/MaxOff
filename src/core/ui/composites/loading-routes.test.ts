import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every route in the shell has its own `loading.tsx` with the shape of its own content
 * (ARCHITECTURE §14.1, a Definition of Done item since task 1.5).
 *
 * This is the check, rather than a reviewer remembering: a new screen added without one would
 * silently fall back to the shell's neutral placeholder, and a screen that passes the wrong
 * shape is exactly the bug this rule exists to stop.
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const appDir = path.join(root, "src/app/(app)");

/** Routes with no server data to wait for; a loading state would never paint. */
const NO_DATA = new Set(["forbidden"]);

function routesWithPages(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const child = path.join(dir, entry.name);
    const route = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (existsSync(path.join(child, "page.tsx"))) found.push(route);
    found.push(...routesWithPages(child, route));
  }
  return found;
}

const routes = routesWithPages(appDir).filter((route) => !NO_DATA.has(route));

describe("loading.tsx coverage", () => {
  it("finds the app routes at all (guards against a silently empty sweep)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(13);
    expect(routes).toContain("tasks/(list)");
    expect(routes).toContain("settings/company");
  });

  it.each(routes)("%s has its own loading.tsx", (route) => {
    expect(existsSync(path.join(appDir, route, "loading.tsx"))).toBe(true);
  });

  it.each(routes)("%s renders its title bar while loading", (route) => {
    // Without a header you cannot tell which screen you are on mid-load. A route whose own
    // layout draws the header (and awaits nothing) keeps it painted while the page loads.
    const source = readFileSync(path.join(appDir, route, "loading.tsx"), "utf8");
    const layouts = route
      .split("/")
      .map((_, i, parts) => path.join(appDir, ...parts.slice(0, i + 1), "layout.tsx"))
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, "utf8"));
    expect(
      /PageLoading|PageHeader/.test(source) || layouts.some((l) => l.includes("<PageHeader")),
    ).toBe(true);
  });

  it("gives each route the shape its real content has", () => {
    const sourceOf = (route: string) =>
      readFileSync(path.join(appDir, route, "loading.tsx"), "utf8");
    const shapeOf = (route: string) => sourceOf(route).match(/shape="(\w+)"/)?.[1];
    // The stand-in routes (3c review, owner decision): while a route shows the stand-in copy of
    // `_placeholder/stand-ins.ts`, its skeleton traces that stand-in (`StandInSkeleton`: the
    // dashed box, the circle, one title line, the measured message lines), never the future
    // screen. The shapes the owner specified come back when each phase builds the real screen:
    // 4.5 Tasks → cards and the Admin's Approvals → list with actions={2}; 5.1 Alerts → list;
    // 6.1 My Day → cards under the strip; 6.2 / 6.3 Today → tiles under the card and the board;
    // 6.4 Calendar → its own day strip (`loading-day-strip`); 6.5 / 9.3 the Admin's Reports →
    // tiles.
    const standIn = "StandInSkeleton";
    expect(sourceOf("today")).toContain(standIn);
    // The Owner's Today keeps the attendance card and the people board in front of the stand-in.
    expect(sourceOf("today")).toContain("TodayBoardSkeleton");
    expect(sourceOf("today")).toContain("TodayAttendanceStripSkeleton");
    expect(sourceOf("my-day")).toContain(standIn);
    expect(sourceOf("my-day")).toContain("TodayAttendanceStripSkeleton");
    // Tasks sits in a `(list)` group since 4B, so its skeleton never wraps a task's page; since
    // 4.5 it traces the real lists: `TaskRow`s under their section headings, per role.
    expect(sourceOf("tasks/(list)")).toContain("TaskRowsSkeleton");
    expect(sourceOf("tasks/(list)")).not.toContain(standIn);
    // The full list (4.5): the toolbar over cards on a phone and the table from `md` up.
    expect(sourceOf("tasks/all")).toContain("loading-toolbar");
    // A task's page (4.4) traces its first card and sections, not a generic detail.
    expect(sourceOf("tasks/[id]")).toContain("loading-task");
    expect(sourceOf("calendar")).toContain(standIn);
    // Alerts (5.1): the "N unread" line and the history rows, traced.
    expect(sourceOf("notifications")).toContain("NotificationListSkeleton");
    expect(sourceOf("notifications")).not.toContain(standIn);
    expect(shapeOf("notifications"), "its own skeleton, not a generic shape").toBeUndefined();
    // Reports (3b.4): the Owner's list of reports first; the Admin's branch is the stand-in.
    expect(shapeOf("reports")).toBe("list");
    expect(sourceOf("reports")).toContain(standIn);
    // Approvals is a grouped list (2.4: the groups are traced by ApprovalGroupSkeleton); since 4.5
    // an Admin's is too (the tasks they check), so no branch shows the stand-in.
    expect(sourceOf("approvals")).toContain("ApprovalGroupSkeleton");
    expect(sourceOf("approvals")).not.toContain(standIn);
    for (const route of ["today", "my-day", "calendar"]) {
      expect(shapeOf(route), `${route} traces the stand-in, not a shape`).toBeUndefined();
    }
    // The team's month traces its own rows (3b review), under the month switcher.
    const teamMonth = sourceOf("reports/month");
    expect(teamMonth).toContain("loading-team-month");
    expect(teamMonth).toContain("loading-leave-pager");
    // The list sits in a route group so its skeleton never wraps a person (2.9).
    expect(shapeOf("people/(list)")).toBe("cards");
    expect(shapeOf("clients/(list)")).toBe("cards");
    expect(shapeOf("settings")).toBe("list");
    expect(shapeOf("me")).toBe("detail");
    // /leave's layout keeps the header and tabs painted; each view traces its own list (2.3),
    // and only the attendance view has the month switcher row.
    expect(shapeOf("leave")).toBe("cards");
    expect(shapeOf("leave/attendance")).toBe("cards");
    expect(sourceOf("leave/attendance")).toContain("loading-leave-pager");
    // A person's page (3.4): the Profile traces its card; the history (2.4) mirrors /leave,
    // requests and the month, under a painted header and tabs.
    expect(sourceOf("people/[id]")).toContain("loading-profile");
    expect(shapeOf("people/[id]/leave")).toBe("cards");
    expect(shapeOf("people/[id]/attendance")).toBe("cards");
    // A person's month (3b.4): the pager and the summary's lines.
    expect(sourceOf("people/[id]/month")).toContain("MonthSummarySkeleton");
    expect(sourceOf("people/[id]/attendance")).toContain("loading-leave-pager");
  });

  it("never lets a route fall back to the avatar list that caused this rule", () => {
    for (const route of routes) {
      const source = readFileSync(path.join(appDir, route, "loading.tsx"), "utf8");
      expect(source, route).not.toContain("size-8 shrink-0 rounded-full");
    }
  });
});
