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
    expect(routes).toContain("tasks");
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
    const shapeOf = (route: string) => {
      const source = readFileSync(path.join(appDir, route, "loading.tsx"), "utf8");
      return source.match(/shape="(\w+)"/)?.[1];
    };
    // The shapes the owner specified, screen by screen.
    expect(shapeOf("today")).toBe("tiles");
    expect(shapeOf("reports")).toBe("tiles");
    expect(shapeOf("tasks")).toBe("cards");
    expect(shapeOf("my-day")).toBe("cards");
    expect(shapeOf("people")).toBe("cards");
    expect(shapeOf("clients")).toBe("cards");
    expect(shapeOf("settings")).toBe("list");
    expect(shapeOf("notifications")).toBe("list");
    expect(shapeOf("me")).toBe("detail");
    // /leave's layout keeps the header and tabs painted; each view traces its own list (2.3),
    // and only the attendance view has the month switcher row.
    expect(shapeOf("leave")).toBe("cards");
    expect(shapeOf("leave/attendance")).toBe("cards");
    expect(readFileSync(path.join(appDir, "leave/attendance/loading.tsx"), "utf8")).toContain(
      "loading-leave-pager",
    );
    // Approvals is a grouped list with two actions per row; calendar draws its own day strip.
    expect(shapeOf("approvals")).toBe("list");
    expect(readFileSync(path.join(appDir, "approvals/loading.tsx"), "utf8")).toContain(
      "actions={2}",
    );
    expect(readFileSync(path.join(appDir, "calendar/loading.tsx"), "utf8")).toContain(
      "loading-day-strip",
    );
  });

  it("never lets a route fall back to the avatar list that caused this rule", () => {
    for (const route of routes) {
      const source = readFileSync(path.join(appDir, route, "loading.tsx"), "utf8");
      expect(source, route).not.toContain("size-8 shrink-0 rounded-full");
    }
  });
});
