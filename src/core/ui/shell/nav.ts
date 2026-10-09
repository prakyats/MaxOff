import { can, type PermissionKey } from "@/core/permissions";

import type { ShellRole } from "./viewer";

/**
 * Icon names, resolved to Lucide components in `nav-icons.ts`. Names, not components, so the
 * nav config stays serialisable across the server → client boundary and pure for tests.
 */
export type NavIconName =
  | "layout-dashboard"
  | "calendar-days"
  | "users"
  | "check-square"
  | "briefcase"
  | "clipboard-list"
  | "file-bar-chart"
  | "settings"
  | "sunrise"
  | "bell"
  | "circle-user"
  | "calendar-check"
  | "receipt"
  | "more";

export type NavItem = {
  /** Stable id used by tests and e2e selectors. */
  key: string;
  label: string;
  href: string;
  icon: NavIconName;
  /** The permission the destination will check. `null` = every signed-in member. */
  permission: PermissionKey | null;
  /** The bottom bar's shorter label, when the sidebar's would not fit a fifth of a phone. */
  barLabel?: string;
  /** Other routes this destination owns besides `href` and what is under it (its other tabs). */
  paths?: readonly string[];
};

/**
 * Counts per nav key (`approvals` since 2.4, `tasks` since 4.5, `alerts` with 5.1): how many
 * things there need the viewer, computed by the layout from real data and **streamed** into the
 * bars (`NavCount`, 4C), so no screen waits for them. The Owner's whole loop is "what needs me",
 * and a bar that carries the count answers it without a tap. Counts are per viewer and never
 * money (ADR-0007).
 */
export type NavBadges = Readonly<Partial<Record<string, number>>>;

/**
 * The count for one spot: the keys added up (the More cell counts every destination hidden behind
 * it, so nothing needing the viewer hides in the sheet). A missing or negative count is nothing.
 */
export function badgeTotal(badges: NavBadges, keys: readonly string[]): number {
  return keys.reduce((total, key) => total + Math.max(0, badges[key] ?? 0), 0);
}

/** The home route for each role (PRODUCT §4.7). */
export function homeFor(role: ShellRole): string {
  return role === "staff" ? "/my-day" : "/today";
}

const today: NavItem = {
  key: "today",
  label: "Today",
  href: "/today",
  icon: "layout-dashboard",
  permission: null,
};
const calendar: NavItem = {
  key: "calendar",
  label: "Calendar",
  href: "/calendar",
  icon: "calendar-days",
  permission: null,
};
const people: NavItem = {
  key: "people",
  label: "People",
  href: "/people",
  icon: "users",
  permission: "team.view",
};
const tasks = (permission: PermissionKey): NavItem => ({
  key: "tasks",
  label: "Tasks",
  href: "/tasks",
  icon: "check-square",
  permission,
});
const clients = (permission: PermissionKey): NavItem => ({
  key: "clients",
  label: "Clients",
  href: "/clients",
  icon: "briefcase",
  permission,
});
const approvals = (permission: PermissionKey): NavItem => ({
  key: "approvals",
  label: "Approvals",
  href: "/approvals",
  icon: "clipboard-list",
  permission,
});
const reports = (permission: PermissionKey): NavItem => ({
  key: "reports",
  label: "Reports",
  href: "/reports",
  icon: "file-bar-chart",
  permission,
});
const settings = (permission: PermissionKey): NavItem => ({
  key: "settings",
  label: "Settings",
  href: "/settings",
  icon: "settings",
  permission,
});

/**
 * The member's own Attendance & leave (2.3; 5B decisions 1-2): two tabs, Leave requests (`/leave`)
 * and Attendance. The Crew's phone bar calls it "Leave".
 */
const leave: NavItem = {
  key: "leave",
  label: "Attendance & leave",
  barLabel: "Leave",
  href: "/leave",
  icon: "calendar-check",
  permission: "attendance.self",
};
/** Extra work & expenses (5B decision 3): two tabs, Extra work and Expenses; on a phone, from Me. */
const work: NavItem = {
  key: "work",
  label: "Extra work & expenses",
  href: "/leave/extra-work",
  icon: "receipt",
  permission: "attendance.self",
  paths: ["/leave/expenses"],
};

/**
 * Primary navigation per role. Owner and Admin see it in the sidebar; Staff (shown as Crew) see
 * it in the sidebar on desktop (5B decision 5: My Day · Tasks · Calendar · Attendance & leave ·
 * Extra work & expenses · Me, the bell at the top) and in the bottom bar on a phone (5B decision
 * 1: My Day · Tasks · Calendar · Leave · Me; Alerts is the title bar's bell, as for the Owner and
 * Admins; Extra work & expenses is a row on Me). Owner and Admin navigation is unchanged
 * (decision 7). Money never appears here: revenue and billing are panels inside Owner screens
 * (ADR-0007).
 */
export const NAV_BY_ROLE: Record<ShellRole, readonly NavItem[]> = {
  owner: [
    today,
    approvals("tasks.approve_final"),
    clients("clients.manage"),
    tasks("tasks.create"),
    calendar,
    people,
    reports("reports.all"),
    settings("settings.manage"),
  ],
  admin: [
    today,
    approvals("tasks.approve_admin"),
    clients("clients.edit_assigned"),
    tasks("tasks.create"),
    calendar,
    people,
    reports("reports.scoped"),
    settings("lists.manage"),
  ],
  staff: [
    { key: "my-day", label: "My Day", href: "/my-day", icon: "sunrise", permission: null },
    tasks("tasks.work"),
    calendar,
    leave,
    work,
    { key: "me", label: "Me", href: "/me", icon: "circle-user", permission: null },
  ],
};

export function navFor(role: ShellRole): readonly NavItem[] {
  return NAV_BY_ROLE[role];
}

/**
 * **The bottom navigation split, for every role** (ARCHITECTURE §14.1, task 1.5). Mobile is a
 * first-class layout, so nobody opens a drawer to reach a screen they use ten times a day.
 *
 * `MOBILE_PRIMARY` is the bar; `MOBILE_MORE` is the sheet behind it. Both are in the **owner's
 * stated priority order** (2026-09-23): today, approvals, tasks, calendar, reports, clients,
 * people, settings. Clients is deliberately not in the bar for either role — a client is set up
 * once and visited occasionally, not daily. Staff need no More: their five tabs, and Extra work &
 * expenses as a row on Me (`MOBILE_VIA_ME`, 5B decision 3).
 *
 * Owner and Admin hold the same four today and stay **separate entries on purpose**: Approvals
 * and Reports will weigh differently for each once they carry real numbers.
 *
 * These arrays are the only place the split lives — changing what a phone shows is one edit
 * here, not three components — and `nav.test.ts` proves together they are exactly the role's
 * navigation, so nothing can be dropped or listed twice.
 *
 * **Revisit after the pilot** from what people actually open (PROGRESS).
 */
export const MOBILE_PRIMARY: Record<ShellRole, readonly string[]> = {
  owner: ["today", "approvals", "tasks", "calendar"],
  admin: ["today", "approvals", "tasks", "calendar"],
  staff: ["my-day", "tasks", "calendar", "leave", "me"],
};

/**
 * Destinations a phone reaches through a row on Me rather than the bar or More (5B decision 3):
 * while one is open, Me is the bar's current tab.
 */
export const MOBILE_VIA_ME: Record<ShellRole, readonly string[]> = {
  owner: [],
  admin: [],
  staff: ["work"],
};

/** Everything the bar didn't take, in the same priority order. */
export const MOBILE_MORE: Record<ShellRole, readonly string[]> = {
  owner: ["reports", "clients", "people", "settings"],
  admin: ["reports", "clients", "people", "settings"],
  staff: [],
};

/**
 * The viewer's own profile. Staff (Crew) have it in their bar (PRODUCT §4.7); for Owner and Admin it
 * is a row of the More sheet rather than one of `NAV_BY_ROLE`, which lists screens, not
 * self-service. It is a real item so that More can read as current while /me is open.
 */
export const PROFILE_NAV_ITEM: NavItem = {
  key: "me",
  label: "Me",
  href: "/me",
  icon: "circle-user",
  permission: null,
};

export type MobileNav = {
  /** The destinations in the bar, in order. */
  primary: readonly NavItem[];
  /** Everything else, for the More sheet. Empty for Staff, who then get no More item. */
  more: readonly NavItem[];
};

/**
 * Splits a role's navigation into the bottom bar and the More sheet, both in priority order, with
 * the bar's shorter labels. Me owns the routes of what a phone reaches from it (`MOBILE_VIA_ME`).
 */
export function mobileNavFor(role: ShellRole): MobileNav {
  const items = navFor(role);
  const pick = (keys: readonly string[]) =>
    keys.flatMap((key) => items.filter((item) => item.key === key));
  const viaMe = pick(MOBILE_VIA_ME[role]).flatMap((item) => [item.href, ...(item.paths ?? [])]);
  const primary = pick(MOBILE_PRIMARY[role]).map((item) => ({
    ...item,
    label: item.barLabel ?? item.label,
    ...(item.key === "me" && viaMe.length > 0 ? { paths: [...(item.paths ?? []), ...viaMe] } : {}),
  }));
  return { primary, more: pick(MOBILE_MORE[role]) };
}

/**
 * The current destination of a list (the sidebar, the bar, the More sheet): the item whose route,
 * or one of its `paths`, holds `pathname` most closely. `/leave/expenses` is Extra work &
 * expenses, not Attendance & leave, although both live under `/leave` (5B decision 3).
 */
export function activeNavKey(pathname: string, items: readonly NavItem[]): string | null {
  let best: { key: string; length: number } | null = null;
  for (const item of items) {
    for (const href of [item.href, ...(item.paths ?? [])]) {
      if (isActivePath(pathname, href) && (!best || href.length > best.length)) {
        best = { key: item.key, length: href.length };
      }
    }
  }
  return best?.key ?? null;
}

/**
 * True when the role's bottom bar already carries a notifications destination. When it doesn't
 * (every role since 5B decision 1), the mobile page title bar carries the bell instead, so the
 * alerts are never behind a scroll position or a sheet.
 */
export function alertsInBottomNav(role: ShellRole): boolean {
  return mobileNavFor(role).primary.some((item) => item.href === "/notifications");
}

export type SettingsSection = {
  key: string;
  label: string;
  href: string;
  description: string;
  permission: PermissionKey;
  /** Roadmap task that builds the section: for the code only, the screen says "Coming soon". */
  arrivesIn: string;
  /** False while the section is still a placeholder card, so nothing links into an empty page. */
  ready: boolean;
};

/**
 * Settings is the Owner's control centre (PRODUCT §4.16). Admins get only the data lists they
 * may edit (PERMISSIONS §1: `lists.manage` with footnote ¹, `templates.manage`), and who on their
 * open tasks can't be reached (`notifications.reachability`, 5.4), and nothing about the company,
 * days off, thresholds, Drive or the team.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: "company",
    label: "Company",
    href: "/settings/company",
    description: "The company name and the timezone everything runs on.",
    permission: "settings.manage",
    arrivesIn: "1.4",
    ready: true,
  },
  {
    key: "days-off",
    label: "Days off & holidays",
    href: "/settings/days-off",
    description: "Weekly off days and the holiday list.",
    permission: "settings.manage",
    arrivesIn: "1.4",
    ready: true,
  },
  {
    key: "thresholds",
    label: "Thresholds",
    href: "/settings/thresholds",
    description: "Reminders, escalations, the logout nudge and the email cap.",
    permission: "settings.manage",
    arrivesIn: "1.4",
    ready: true,
  },
  {
    key: "notifications",
    label: "Notifications",
    href: "/settings/notifications",
    description: "Who can't be reached by push, and why.",
    // The Owner sees everyone; an Admin the people on their open tasks (PERMISSIONS §1).
    permission: "notifications.reachability",
    arrivesIn: "5.4",
    ready: true,
  },
  {
    key: "expenses",
    label: "Expenses",
    href: "/settings/expenses",
    description: "Expense categories and when a claim needs a receipt photo.",
    permission: "expenses.decide",
    arrivesIn: "3b.3",
    ready: true,
  },
  {
    key: "job-titles",
    label: "Job titles",
    href: "/settings/job-titles",
    description: "The titles people can be given.",
    permission: "lists.manage",
    arrivesIn: "1.4",
    ready: true,
  },
  {
    key: "task-types",
    label: "Task types",
    href: "/settings/task-types",
    description: "The kinds of task, their order and what each asks for.",
    // The Owner's list (Kickoff 4 decision 15), although lists.manage opens the others to Admins.
    permission: "settings.manage",
    arrivesIn: "4.1",
    ready: true,
  },
  {
    key: "stage-presets",
    label: "Stage presets",
    href: "/settings/stage-presets",
    description: "Reusable stage checklists.",
    permission: "lists.manage",
    arrivesIn: "7.4",
    ready: true,
  },
  {
    key: "custom-fields",
    label: "Custom fields",
    href: "/settings/custom-fields",
    description: "Extra fields on clients and contacts, for everyone or for one client.",
    permission: "lists.manage",
    arrivesIn: "3.2",
    ready: true,
  },
  {
    key: "templates",
    label: "Templates",
    href: "/settings/templates",
    description: "Project and task templates for work that repeats.",
    permission: "templates.manage",
    arrivesIn: "4.6",
    ready: true,
  },
  {
    key: "drive",
    label: "Google Drive",
    href: "/settings/drive",
    description: "The archive account and the archive queue.",
    permission: "drive.manage",
    arrivesIn: "8.3",
    ready: false,
  },
];

export function settingsSectionsFor(role: ShellRole): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => can(role, section.permission));
}

/** True when `pathname` is `href` or a route beneath it (used for the active nav state). */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
