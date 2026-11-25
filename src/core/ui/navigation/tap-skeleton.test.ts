import { describe, expect, it } from "vitest";

import { TAB_CASES, TAB_TOP_LEVEL } from "./move-cases";
import { tabMove } from "./moves";
import { NAV_PENDING_ATTRIBUTE } from "./progress";
import {
  backLabelFrom,
  claimedBy,
  drawingOrder,
  NAV_PENDING,
  pathTarget,
  registerTapSpec,
  tabHistoryWrite,
  type TapSpec,
} from "./tap-skeleton";

const ORIGIN = "https://app.example";
const TOP_LEVEL = [...TAB_TOP_LEVEL, "/calendar"];

const spec = (key: string, prefix: string): TapSpec => ({
  key,
  match: (href, origin) => {
    const url = new URL(href, origin);
    return url.origin === origin && url.pathname.startsWith(prefix)
      ? { pathname: url.pathname, href: url.pathname, variant: "only" }
      : null;
  },
  screen: `[data-slot="loading-${key}"]`,
  backLabel: () => "Back",
  drawing: () => undefined,
});

describe("the tap-skeleton engine (#143, v7.0)", () => {
  it("names the attribute the progress bar sets", () => {
    expect(NAV_PENDING).toBe(NAV_PENDING_ATTRIBUTE);
  });

  it("finds the registered screen that claims a link, and none for an unclaimed one", () => {
    registerTapSpec(spec("alpha", "/alpha/"));
    registerTapSpec(spec("beta", "/beta/"));
    expect(claimedBy("/alpha/1", ORIGIN)).toBe("alpha");
    expect(claimedBy(`${ORIGIN}/beta/2`, ORIGIN)).toBe("beta");
    expect(claimedBy("/gamma/3", ORIGIN)).toBeNull();
    expect(claimedBy("https://elsewhere.example/alpha/1", ORIGIN)).toBeNull();
  });

  it("keeps one spec per key: registering again replaces it", () => {
    registerTapSpec(spec("alpha", "/alpha-new/"));
    expect(claimedBy("/alpha/1", ORIGIN)).toBeNull();
    expect(claimedBy("/alpha-new/1", ORIGIN)).toBe("alpha");
  });
});

describe("a bar tab's history on the tap (v7.0, decision (a))", () => {
  // The one table of moves (`move-cases.ts`): the copy writes only what the bar's move will.
  const WRITE = { push: "push", replace: "none", back: "none" } as const;
  it.each(TAB_CASES)("$name", ({ input, expected }) => {
    const move = tabMove({ ...input, home: "/today", topLevel: TOP_LEVEL });
    expect(move).toBe(expected);
    expect(tabHistoryWrite(move)).toBe(expected === null ? "push" : WRITE[expected]);
  });

  it("home → a tab pushes the tab's address; a tab → a tab or home writes nothing", () => {
    const at = (href: string, pathname: string, pushedFromHome: boolean) =>
      tabHistoryWrite(
        tabMove({
          href,
          pathname,
          home: "/today",
          topLevel: TOP_LEVEL,
          standalone: true,
          pushedFromHome,
        }),
      );
    expect(at("/tasks", "/today", false)).toBe("push");
    expect(at("/calendar", "/tasks", true)).toBe("none");
    // A back: nothing written, and its popstate clears the tap before the copy's moment.
    expect(at("/today", "/tasks", true)).toBe("none");
    // Home with nothing of ours beneath (a reload on a tab) replaces: nothing written.
    expect(at("/today", "/tasks", false)).toBe("none");
  });

  it("in a browser tab the bar is plain links: a push, as a drill-down", () => {
    const move = tabMove({
      href: "/calendar",
      pathname: "/tasks",
      home: "/today",
      topLevel: TOP_LEVEL,
      standalone: false,
      pushedFromHome: true,
    });
    expect(tabHistoryWrite(move)).toBe("push");
  });
});

describe("a drawing's back label (v7.0)", () => {
  const label = backLabelFrom("People", [
    { path: "/today", label: "Today" },
    { path: "/reports/end-of-day/*", label: "End of day" },
  ]);
  it("names the origin it was tapped from, a prefix too", () => {
    expect(label("/today")).toBe("Today");
    expect(label("/reports/end-of-day/2026-11-25")).toBe("End of day");
  });
  it("names the parent from anywhere else", () => {
    expect(label("/people")).toBe("People");
    expect(label("/calendar")).toBe("People");
  });
});

describe("pathTarget (v7.0)", () => {
  const PAGE = /^\/people\/[0-9a-f-]{36}$/;
  const ID = "c3d26307-1f2a-4b5c-8d9e-0a1b2c3d4e5f";
  it("claims the screen's own path, on this origin", () => {
    expect(pathTarget(`/people/${ID}`, ORIGIN, PAGE)).toMatchObject({
      pathname: `/people/${ID}`,
      href: `/people/${ID}`,
    });
    expect(pathTarget(`${ORIGIN}/people/${ID}`, ORIGIN, PAGE)?.pathname).toBe(`/people/${ID}`);
  });
  it("not another site, another path, a query it does not allow, or a broken address", () => {
    expect(pathTarget(`https://elsewhere.example/people/${ID}`, ORIGIN, PAGE)).toBeNull();
    expect(pathTarget(`/people/${ID}/history`, ORIGIN, PAGE)).toBeNull();
    expect(pathTarget(`/people/${ID}?history=1`, ORIGIN, PAGE)).toBeNull();
    expect(pathTarget("http://[bad", ORIGIN, PAGE)).toBeNull();
  });
  it("keeps the queries it allows", () => {
    expect(pathTarget(`/people/${ID}?tab=a`, ORIGIN, PAGE, ["tab"])?.href).toBe(
      `/people/${ID}?tab=a`,
    );
  });
});

describe("the pre-render's order (v7.0, decision (c))", () => {
  const all = [
    { id: "task:work", group: "drill" as const },
    { id: "today:only", group: "tab" as const },
    { id: "client:only", group: "drill" as const },
    { id: "tasks:only", group: "tab" as const },
    { id: "calendar:only", group: "tab" as const },
  ];
  it("the links on screen first, then the other tabs, then the drill-downs", () => {
    expect(drawingOrder(all, ["client:only", "tasks:only"])).toEqual([
      "client:only",
      "tasks:only",
      "today:only",
      "calendar:only",
      "task:work",
    ]);
  });
  it("drops what it does not know and lists nothing twice", () => {
    expect(drawingOrder(all, ["nowhere:only", "tasks:only", "tasks:only"])).toEqual([
      "tasks:only",
      "today:only",
      "calendar:only",
      "task:work",
      "client:only",
    ]);
  });
});
