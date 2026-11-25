import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { homeFor, mobileNavFor } from "@/core/ui/shell/nav";
import type { ShellRole } from "@/core/ui/shell/viewer";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/elsewhere",
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { drawingsFor } = await import("./tap-drawings");
const { dayContext, dateLine } = await import("@/modules/dashboards");
const { SERVER_PARTS } = await import("./skeleton-parts");
const { TodaySkeleton } = await import("./today/today-skeleton");
const { DELIVERABLE_COLUMNS_COPY, PROJECT_ROW_STATE_COPY } = await import("./drawings/client");
const { DELIVERABLE_COLUMNS } = await import("@/modules/client-work");

const ROLES: readonly ShellRole[] = ["owner", "admin", "staff"];
/** The bar's tabs and home, as the layout passes them. */
const barOf = (role: ShellRole) => [
  homeFor(role),
  ...mobileNavFor(role).primary.map((i) => i.href),
];
const ORIGIN = "https://app.example";
const ID = "c3d26307-1f2a-4b5c-8d9e-0a1b2c3d4e5f";
const ID2 = "0f1e2d3c-4b5a-4968-8776-655443322110";

/** A fixture member: their name must never reach a drawing. */
const NAME = "Zebulon Quill";

const MONTHS =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
const WEEKDAYS = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;
const ISO_DATE = /\b20\d\d-[01]\d-[0-3]\d\b/;
const YEAR = /\b20\d\d\b/;

/** What a drawing's markup says that is a member's or a day's, the way a check would find it. */
function memberDataIn(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, " ");
  return [
    html.includes("Zebulon") || html.includes("Quill") ? "the member's name" : null,
    MONTHS.test(text) ? "a month's name" : null,
    WEEKDAYS.test(text) ? "a weekday" : null,
    ISO_DATE.test(html) ? "a date" : null,
    YEAR.test(text) ? "a year" : null,
  ].filter((found): found is string => found !== null);
}

const render = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);

/** The spec of `role`'s drawings claiming `href`, with the drawing it shows. */
function claim(role: ShellRole, href: string): string | null {
  for (const { spec } of drawingsFor(role, barOf(role), 5)) {
    const target = spec.match(href, ORIGIN);
    if (target) return `${spec.key}:${target.variant}`;
  }
  return null;
}

describe("the tap drawings (v7.0, the first set)", () => {
  it.each(ROLES)("every tab of the %s's bar, and home, has a drawing", (role) => {
    const keys = new Set(
      drawingsFor(role, barOf(role), 5).flatMap(({ spec, variants }) =>
        variants.map((variant) => `${spec.key}:${variant}`),
      ),
    );
    for (const href of barOf(role)) {
      const claimed = claim(role, href);
      expect(claimed, `${role}: ${href}`).not.toBeNull();
      expect(keys.has(claimed!)).toBe(true);
      const drawing = drawingsFor(role, barOf(role), 5).find(({ spec }) =>
        spec.match(href, ORIGIN),
      );
      expect(drawing?.group, `${href} is a tab`).toBe("tab");
      expect(drawing?.spec.history, `${href} moves as a tab`).toBe("tab");
    }
  });

  it("claims each screen's own links, by role", () => {
    for (const role of ROLES) {
      expect(claim(role, `/tasks/${ID}`)).toBe("task:work");
      expect(claim(role, `/tasks/${ID}?tab=chat`)).toBe("task:chat");
    }
    for (const role of ["owner", "admin"] as const) {
      expect(claim(role, `/clients/${ID}`)).toBe("client:only");
      expect(claim(role, `${ORIGIN}/clients/${ID}/projects/${ID2}`)).toBe("project:only");
      expect(claim(role, `/people/${ID}`)).toBe("person:profile");
    }
    expect(claim("owner", `/people/${ID}/leave`)).toBe("person:leave");
    expect(claim("owner", `/people/${ID}/attendance`)).toBe("person:attendance");
    expect(claim("owner", `/people/${ID}/month`)).toBe("person:month");
    expect(claim("owner", `/people/${ID}/month?month=2026-10`)).toBe("person:month");
    // An Admin's person page is the Profile alone.
    expect(claim("admin", `/people/${ID}/leave`)).toBe("person:leave");
    expect(
      drawingsFor("admin", barOf("admin"), 5).find(({ spec }) => spec.key === "person")?.variants,
    ).toEqual(["profile"]);
  });

  it("claims nothing else: another tab's view, a query, a list, another record's screen, another site", () => {
    for (const role of ROLES) {
      expect(claim(role, "/tasks?view=held")).toBeNull();
      expect(claim(role, "/tasks/all")).toBeNull();
      expect(claim(role, `https://elsewhere.example/tasks/${ID}`)).toBeNull();
      expect(claim(role, "/settings")).toBeNull();
      expect(claim(role, "/notifications")).toBeNull();
    }
    expect(claim("owner", "/clients")).toBeNull();
    expect(claim("owner", `/clients/${ID}/projects`)).toBeNull();
    expect(claim("owner", `/clients/${ID}/brand`)).toBeNull();
    expect(claim("owner", `/clients/${ID}?history=1`)).toBeNull();
    expect(claim("owner", `/clients/${ID}/contacts/${ID2}`)).toBeNull();
    expect(claim("owner", `/people/${ID}/history`)).toBeNull();
    expect(claim("owner", `/people/${ID}?tab=x`)).toBeNull();
    expect(claim("owner", "/people")).toBeNull();
    expect(claim("owner", "/clients/not-an-id")).toBeNull();
    // The Crew never see a client's records or the team (invariant 4, PERMISSIONS).
    expect(claim("staff", `/clients/${ID}`)).toBeNull();
    expect(claim("staff", `/clients/${ID}/projects/${ID2}`)).toBeNull();
    expect(claim("staff", `/people/${ID}`)).toBeNull();
    // The More sheet's destinations are a later set.
    expect(claim("owner", "/reports")).toBeNull();
    expect(claim("owner", "/me")).toBeNull();
    expect(claim("admin", "/leave")).toBeNull();
  });

  it("each drill-down's back names the screen tapped from, else its parent", () => {
    const back = (role: ShellRole, key: string, from: string) =>
      drawingsFor(role, barOf(role), 5)
        .find(({ spec }) => spec.key === key)
        ?.spec.backLabel(from);
    expect(back("owner", "task", "/calendar")).toBe("Calendar");
    expect(back("owner", "task", "/reports/end-of-day/2026-11-24")).toBe("End of day");
    expect(back("owner", "client", "/today")).toBe("Today");
    expect(back("owner", "client", "/clients")).toBe("Clients");
    expect(back("admin", "project", "/calendar")).toBe("Calendar");
    expect(back("admin", "project", `/clients/${ID}/projects`)).toBe("the client");
    expect(back("owner", "person", "/approvals")).toBe("Approvals");
    expect(back("owner", "person", "/reports/end-of-day/2026-11-24")).toBe("End of day");
    expect(back("admin", "person", "/people")).toBe("People");
  });

  it.each(ROLES)(
    "each %s drawing is its screen's loading screen (its spec's screen is in it)",
    async (role) => {
      for (const { spec, variants, load } of drawingsFor(role, barOf(role), 5)) {
        const draw = await load();
        const marks = [...spec.screen.matchAll(/\[(data-slot|aria-label)="([^"]+)"\]/g)].map(
          ([, name, value]) => `${name}="${value}"`,
        );
        for (const variant of variants) {
          const html = render(draw(variant));
          expect(
            marks.some((mark) => html.includes(mark)),
            `${role}: ${spec.key}:${variant} draws one of ${marks.join(", ")}`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(ROLES)("no %s drawing carries member data (decision (b))", async (role) => {
    for (const { spec, variants, load } of drawingsFor(role, barOf(role), 5)) {
      const draw = await load();
      for (const variant of variants) {
        expect(memberDataIn(render(draw(variant))), `${role}: ${spec.key}:${variant}`).toEqual([]);
      }
    }
  });

  it("the check bites: Today's loading screen as the server draws it names the member and the date", () => {
    const today = "2026-11-25";
    const server = render(
      <TodaySkeleton
        parts={SERVER_PARTS}
        owner
        strip={false}
        context={dayContext(today, NAME)}
        line={dateLine(today)}
      />,
    );
    expect(memberDataIn(server)).toEqual(
      expect.arrayContaining(["the member's name", "a month's name", "a weekday"]),
    );
  });

  it("the drawings' copies of two class strings are the modules' own", () => {
    expect(PROJECT_ROW_STATE_COPY).toBe(SERVER_PARTS.PROJECT_ROW_STATE);
    expect(DELIVERABLE_COLUMNS_COPY).toBe(DELIVERABLE_COLUMNS);
  });
});
