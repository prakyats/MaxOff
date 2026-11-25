"use client";

import { useMemo } from "react";

import { can } from "@/core/permissions";
import { type TapDrawing, TapDrawingHost } from "@/core/ui/navigation/tap-drawings";
import { backLabelFrom, pathTarget } from "@/core/ui/navigation/tap-skeleton";
import type { ShellRole } from "@/core/ui/shell/viewer";
import { TASK_TAP, TASK_TAP_VIEWS } from "@/modules/tasks/components/task-tap";

import type { AfterPageProps } from "./after-page-lazy";
import { CLIENT_BACK } from "./clients/[id]/back";
import { PROJECT_ORIGINS } from "./clients/[id]/projects/[projectId]/back";
import { PERSON_BACK } from "./people/[id]/back";

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CLIENT_PAGE = new RegExp(`^/clients/${ID}$`, "i");
const PROJECT_PAGE = new RegExp(`^/clients/${ID}/projects/${ID}$`, "i");
const PERSON_PAGE = new RegExp(`^/people/${ID}(?:/(leave|attendance|month))?$`, "i");

/** A person's views as the drawings name them: Profile, then the Owner's three tabs. */
const PERSON_VIEWS = ["profile", "leave", "attendance", "month"] as const;

type Spec = TapDrawing["spec"];

/** A screen at the paths `pattern` matches, with no query: one drawing. */
function record(pattern: RegExp): Spec["match"] {
  return (href, origin) => {
    const target = pathTarget(href, origin, pattern);
    return target ? { pathname: target.pathname, href: target.href, variant: "only" } : null;
  };
}

/** A bar tab's screen (`history: "tab"`): no back control to name. */
function tab(key: string, path: string, screen: string, load: TapDrawing["load"]): TapDrawing {
  return {
    spec: {
      key,
      match: record(new RegExp(`^${path}$`)),
      screen,
      backLabel: () => "",
      history: "tab",
    },
    group: "tab",
    variants: ["only"],
    load,
  };
}

/** Each bar tab's drawing for `role`, by its path: the route's own loading screen. */
function tabDrawing(role: ShellRole, path: string, weeks: number): TapDrawing | null {
  switch (path) {
    case "/today":
      return tab(
        "today",
        path,
        '[data-slot="loading-today"], [data-slot="owner-today"], [data-slot="admin-today"]',
        () => import("./drawings/today").then((m) => m.drawToday(role)),
      );
    case "/my-day":
      return tab("my-day", path, '[data-slot="loading-my-day"], [data-slot="my-day"]', () =>
        import("./drawings/today").then((m) => m.drawMyDay(role)),
      );
    case "/approvals":
      return tab(
        "approvals",
        path,
        '[data-slot="loading-approvals"], [data-slot="approvals-page"]',
        () => import("./drawings/approvals").then((m) => m.drawApprovals(role)),
      );
    case "/tasks":
      return tab(
        "tasks",
        path,
        '[data-slot="loading-tasks"], [data-slot="tasks-team"], [data-slot="tasks-mine"]',
        () => import("./drawings/tasks").then((m) => m.drawTasks(role)),
      );
    case "/calendar":
      return tab("calendar", path, '[data-slot="loading-calendar"], [data-slot="calendar"]', () =>
        import("./drawings/calendar").then((m) => m.drawCalendar(role, weeks)),
      );
    case "/leave":
      return {
        ...tab("leave", path, '[data-slot="leave-tabs"][aria-label="Attendance and leave"]', () =>
          import("./drawings/leave").then((m) => m.drawLeave()),
        ),
        at: path,
      };
    case "/me":
      return tab("me", path, '[aria-label="Loading Me"], [data-slot="me-identity"]', () =>
        import("./drawings/me").then((m) => m.drawMe(role)),
      );
    default:
      return null;
  }
}

/** The drill-downs `role` opens: a task, and for the Owner and Admins a client, a project, a person. */
function drillDrawings(role: ShellRole): TapDrawing[] {
  const drawings: TapDrawing[] = [
    {
      spec: TASK_TAP,
      group: "drill",
      variants: TASK_TAP_VIEWS,
      load: () => import("./drawings/tasks").then((m) => m.drawTask(role)),
    },
  ];
  if (can(role, "clients.manage") || can(role, "clients.edit_assigned")) {
    drawings.push(
      {
        spec: {
          key: "client",
          match: record(CLIENT_PAGE),
          screen: '[data-slot="loading-client-overview"], [data-slot="client-overview"]',
          backLabel: backLabelFrom(CLIENT_BACK.label, CLIENT_BACK.from),
        },
        group: "drill",
        variants: ["only"],
        load: () => import("./drawings/client").then((m) => m.drawClient(role)),
        // Its tabs drawn at a client's address, so Overview is the current one.
        at: "/clients/client",
      },
      {
        spec: {
          key: "project",
          match: record(PROJECT_PAGE),
          screen: '[data-slot="loading-project"], [data-slot="project-page"]',
          backLabel: backLabelFrom("the client", PROJECT_ORIGINS),
        },
        group: "drill",
        variants: ["only"],
        load: () => import("./drawings/client").then((m) => m.drawProject()),
      },
    );
  }
  if (can(role, "team.view")) {
    drawings.push({
      spec: {
        key: "person",
        match: (href, origin) => {
          // A person's month opens on a month (`?month=`), the same drawing.
          const target = pathTarget(href, origin, PERSON_PAGE, ["month"]);
          if (target === null) return null;
          const view = PERSON_PAGE.exec(target.pathname)?.[1] ?? "profile";
          return { pathname: target.pathname, href: target.href, variant: view.toLowerCase() };
        },
        screen:
          '[data-slot="loading-person-tabs"], [data-slot="person-tabs"], [data-slot="loading-profile"], [data-slot="person-profile"]',
        backLabel: backLabelFrom(PERSON_BACK.label, PERSON_BACK.from),
      },
      group: "drill",
      // An Admin's person page is the Profile alone (the tabs are the Owner's, `showsHistory`).
      variants: can(role, "attendance.view_all") ? PERSON_VIEWS : ["profile"],
      load: () => import("./drawings/person").then((m) => m.drawPerson(role)),
    });
  }
  return drawings;
}

/**
 * Every screen a tap can draw for `role` (v7.0, the first set; `weeks`: the calendar's opening
 * rows, counted on the server): each of `tabs`, the role's phone
 * bar and its home (`mobileNavFor`, passed in by the layout: importing `nav.ts` here moved the whole
 * of it into every screen's first load, +1.4 KB), then the drill-downs (a task, a client, a
 * project, a person and its tabs). Each drawing is the route's own loading screen, the same
 * component its `loading.tsx` renders, with **no member data**: no name, no date, no record (bars
 * instead; the unit test renders them with a fixture name and looks for it). Each screen's drawing
 * code is a chunk of its own (`drawings/`), loaded when its first drawing is made. The More
 * sheet's destinations are not here yet (ROADMAP).
 */
export function drawingsFor(role: ShellRole, tabs: readonly string[], weeks: number): TapDrawing[] {
  const bar = [...new Set(tabs)].flatMap((path) => tabDrawing(role, path, weeks) ?? []);
  return [...bar, ...drillDrawings(role)];
}

/**
 * The tap drawings (`TapDrawingHost`, core), loaded after the page by the `(app)` layout's one
 * loader (`after-page.tsx`): the app holds the screens, core the engine.
 */
export function TapDrawings({ role, tabs, weeks }: AfterPageProps) {
  const key = tabs.join(" ");
  // Once per viewer, bar and month (`tabs` is a new array on each render of the layout).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const drawings = useMemo(() => drawingsFor(role, tabs, weeks), [role, key, weeks]);
  return <TapDrawingHost drawings={drawings} viewer={role} />;
}
