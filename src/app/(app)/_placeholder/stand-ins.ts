/**
 * What the stand-in screens say until their real screens arrive (kickoff 3c amendment (3e),
 * "friendly placeholder copy before any invite"): what the screen will be for and that it is
 * coming, in the app's voice (PRODUCT §1-§2: plain, short, second person). No task numbers and
 * no build words reach a user; the roadmap task that replaces each screen is named in a comment.
 *
 * `stand-ins.test.ts` keeps the words plain, and `e2e/mobile.spec.ts` reads each screen at 375
 * and 430px against this file.
 */
import type { MemberRole } from "@/core/permissions";

export type StandIn = {
  /** The page header's line (a phone shows the title only, ARCHITECTURE §14.1). */
  description: string;
  /** The empty state: what is coming. */
  title: string;
  /** The empty state's line: what the screen will be for, and what to use until then. */
  message: string;
};

const ALERTS_DESCRIPTION = "Your notifications, each one a tap away from what it's about.";

export const STAND_INS = {
  /** Alerts for Admins and Staff (task 5.1). */
  alertsMember: {
    description: ALERTS_DESCRIPTION,
    title: "Alerts are coming soon",
    message:
      "You'll get a note here when something needs you or one of your requests is decided. Until then, Attendance & leave shows where your requests stand.",
  },
  /** Alerts for the Owner (task 5.1), whose waiting work is already on Approvals. */
  alertsOwner: {
    description: ALERTS_DESCRIPTION,
    title: "Alerts are coming soon",
    message:
      "You'll get a note here when something needs you. Until then, everything waiting for you is on Approvals.",
  },
  /** The calendar, every role (task 6.4). */
  calendar: {
    description: "Shoots, meetings, leave and holidays, by day, week and month.",
    title: "The calendar is coming soon",
    message:
      "Shoots, meetings, approved leave and holidays will all be here, by day, week and month.",
  },
  /** An Admin's Reports (tasks 6.5 and 9.x); the Owner's list is real since 3b.4. */
  reportsAdmin: {
    description: "How the work you run is going.",
    title: "Your reports are coming soon",
    message:
      "They'll show how the work you run is going: what's on time, what's late and where it waits longest.",
  },
  /** The Owner's Today below the attendance card and the board (task 6.2). */
  todayOwner: {
    description: "Who's in today and what needs you.",
    title: "More of your day is coming soon",
    message: "Tasks, client work and anything running late will join today's attendance here.",
  },
  /** An Admin's Today below the attendance strip (task 6.3). */
  todayAdmin: {
    description: "Your working day and what needs you.",
    title: "More of your day is coming soon",
    message:
      "The tasks that need you and your clients' work will join your day here. For now, MaxOff is for your day, leave, expenses and clients.",
  },
  /** My Day below the attendance strip (task 6.1). */
  myDay: {
    description: "Your working day and what's next.",
    title: "More of your day is coming soon",
    message:
      "Your tasks for today and what's due next will join your day here. For now, MaxOff is for your working day, leave and expenses.",
  },
} as const satisfies Record<string, StandIn>;

/**
 * The day screens' stand-in, by who is looking, on `/today` and `/my-day` alike (3cB review): the
 * Owner has no day of their own (their Today is the team's), an Admin's day includes their
 * clients, and a Staff member's is their working day, leave and expenses, also when they open
 * `/today` by typing it or through a `?next=` after sign-in.
 */
export function dayStandIn(role: MemberRole): StandIn {
  if (role === "owner") return STAND_INS.todayOwner;
  if (role === "admin") return STAND_INS.todayAdmin;
  return STAND_INS.myDay;
}

/**
 * A stand-in screen's header line: what `PlaceholderPage` writes (greeting the member on the
 * dashboards) and what its loading screen repeats, so the header does not change when the page
 * arrives (4C review S7, ARCHITECTURE §14.1).
 */
export function standInDescription(copy: StandIn, greet?: string): string {
  return greet ? `Hello, ${greet}. ${copy.description}` : copy.description;
}
