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
  | "more";

export type NavItem = {
  /** Stable id used by tests and e2e selectors. */
  key: string;
  label: string;
  href: string;
  icon: NavIconName;
  /** The permission the destination will check. `null` = every signed-in member. */
  permission: PermissionKey | null;
  /**
   * How many things there need the viewer, shown as a count on the icon. Nothing sets it yet:
   * **2.4** sets it on Approvals (pending attendance + leave) and **5.1** on Alerts (unread
   * notifications). The Owner's whole loop is "what needs me", and a bar that carries the count
   * answers it without a tap. Counts are per viewer and never money (ADR-0007).
   */
  badge?: number;
};

/**
 * What the More cell shows: the counts of the destinations hidden behind it, added up. Without
 * this, a role whose Approvals sits in More would have no way of knowing anything was waiting.
 * Zero means no badge.
 */
export function totalBadge(items: readonly NavItem[]): number {
  return items.reduce((total, item) => total + Math.max(0, item.badge ?? 0), 0);
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
 * Primary navigation per role. Owner and Admin see it in the sidebar; Staff see it in the
 * bottom bar on mobile (PRODUCT §4.7: My Day · Tasks · Calendar · Alerts · Me).
 * Money never appears here: revenue and billing are panels inside Owner screens (ADR-0007).
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
    { key: "alerts", label: "Alerts", href: "/notifications", icon: "bell", permission: null },
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
 * once and visited occasionally, not daily. Staff keep PRODUCT §4.7 unchanged and need no More:
 * those five are all the screens they have.
 *
 * Owner and Admin hold the same four today and stay **separate entries on purpose**: Approvals
 * and Reports will weigh differently for each once they carry real numbers.
 *
 * These two arrays are the only place the split lives — changing what a phone shows is one edit
 * here, not three components — and `nav.test.ts` proves together they are exactly the role's
 * navigation, so nothing can be dropped or listed twice.
 *
 * **Revisit after the pilot** from what people actually open (PROGRESS).
 */
export const MOBILE_PRIMARY: Record<ShellRole, readonly string[]> = {
  owner: ["today", "approvals", "tasks", "calendar"],
  admin: ["today", "approvals", "tasks", "calendar"],
  staff: ["my-day", "tasks", "calendar", "alerts", "me"],
};

/** Everything the bar didn't take, in the same priority order. */
export const MOBILE_MORE: Record<ShellRole, readonly string[]> = {
  owner: ["reports", "clients", "people", "settings"],
  admin: ["reports", "clients", "people", "settings"],
  staff: [],
};

/**
 * The viewer's own profile. Staff have it in their bar (PRODUCT §4.7); for Owner and Admin it
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

/** Splits a role's navigation into the bottom bar and the More sheet, both in priority order. */
export function mobileNavFor(role: ShellRole): MobileNav {
  const items = navFor(role);
  const pick = (keys: readonly string[]) =>
    keys.flatMap((key) => items.filter((item) => item.key === key));
  return { primary: pick(MOBILE_PRIMARY[role]), more: pick(MOBILE_MORE[role]) };
}

/**
 * True when the role's bottom bar already carries a notifications destination. When it doesn't
 * (Owner and Admin), the mobile page title bar carries the bell instead, so the alerts are
 * never behind a scroll position or a sheet.
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
  /** Roadmap task that builds the section. */
  arrivesIn: string;
  /** False while the section is still a placeholder card, so nothing links into an empty page. */
  ready: boolean;
};

/**
 * Settings is the Owner's control centre (PRODUCT §4.16). Admins get only the data lists they
 * may edit (PERMISSIONS §1: `lists.manage` with footnote ¹, `templates.manage`) and nothing
 * about the company, days off, thresholds, Drive or the team.
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
    description: "Kinds of task, their behaviour and default reminders.",
    permission: "lists.manage",
    arrivesIn: "4.1",
    ready: false,
  },
  {
    key: "stage-presets",
    label: "Stage presets",
    href: "/settings/stage-presets",
    description: "Reusable stage checklists.",
    permission: "lists.manage",
    arrivesIn: "7.4",
    ready: false,
  },
  {
    key: "custom-fields",
    label: "Custom fields",
    href: "/settings/custom-fields",
    description: "Extra fields on clients, projects, items and tasks.",
    permission: "lists.manage",
    arrivesIn: "3.2",
    ready: false,
  },
  {
    key: "templates",
    label: "Templates",
    href: "/settings/templates",
    description: "Project and task templates.",
    permission: "templates.manage",
    arrivesIn: "4.6",
    ready: false,
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
