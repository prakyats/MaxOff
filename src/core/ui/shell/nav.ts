import type { ShellRole } from "./viewer";

/**
 * Permission keys from PERMISSIONS.md §1. Only the keys the navigation refers to are listed
 * here; `core/permissions` (task 1.1) becomes the registry and this alias moves there.
 */
export type NavPermission =
  | "team.view"
  | "team.manage"
  | "settings.manage"
  | "drive.manage"
  | "lists.manage"
  | "templates.manage"
  | "clients.manage"
  | "clients.edit_assigned"
  | "tasks.create"
  | "tasks.approve_admin"
  | "tasks.approve_final"
  | "tasks.work"
  | "attendance.self"
  | "reports.all"
  | "reports.scoped";

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
  | "circle-user";

export type NavItem = {
  /** Stable id used by tests and e2e selectors. */
  key: string;
  label: string;
  href: string;
  icon: NavIconName;
  /** The permission the destination will check. `null` = every signed-in member. */
  permission: NavPermission | null;
};

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
const tasks = (permission: NavPermission): NavItem => ({
  key: "tasks",
  label: "Tasks",
  href: "/tasks",
  icon: "check-square",
  permission,
});
const clients = (permission: NavPermission): NavItem => ({
  key: "clients",
  label: "Clients",
  href: "/clients",
  icon: "briefcase",
  permission,
});
const approvals = (permission: NavPermission): NavItem => ({
  key: "approvals",
  label: "Approvals",
  href: "/approvals",
  icon: "clipboard-list",
  permission,
});
const reports = (permission: NavPermission): NavItem => ({
  key: "reports",
  label: "Reports",
  href: "/reports",
  icon: "file-bar-chart",
  permission,
});
const settings = (permission: NavPermission): NavItem => ({
  key: "settings",
  label: "Settings",
  href: "/settings",
  icon: "settings",
  permission,
});

/**
 * Primary navigation per role. CEO and Admin see it in the sidebar; Staff see it in the
 * bottom bar on mobile (PRODUCT §4.7: My Day · Tasks · Calendar · Alerts · Me).
 * Money never appears here: revenue and billing are panels inside CEO screens (ADR-0007).
 */
export const NAV_BY_ROLE: Record<ShellRole, readonly NavItem[]> = {
  ceo: [
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

export type SettingsSection = {
  key: string;
  label: string;
  href: string;
  permission: NavPermission;
  /** Roadmap task that builds the section. */
  arrivesIn: string;
};

/**
 * Settings is the CEO's control centre (PRODUCT §4.16). Admins get only the data lists they
 * may edit (PERMISSIONS §1: `lists.manage` with footnote ¹, `templates.manage`) and nothing
 * about the company, days off, thresholds, Drive or the team.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: "company",
    label: "Company",
    href: "/settings/company",
    permission: "settings.manage",
    arrivesIn: "1.4",
  },
  {
    key: "days-off",
    label: "Days off & holidays",
    href: "/settings/days-off",
    permission: "settings.manage",
    arrivesIn: "1.4",
  },
  {
    key: "thresholds",
    label: "Thresholds",
    href: "/settings/thresholds",
    permission: "settings.manage",
    arrivesIn: "1.4",
  },
  {
    key: "job-titles",
    label: "Job titles",
    href: "/settings/job-titles",
    permission: "lists.manage",
    arrivesIn: "1.4",
  },
  {
    key: "task-types",
    label: "Task types",
    href: "/settings/task-types",
    permission: "lists.manage",
    arrivesIn: "4.1",
  },
  {
    key: "stage-presets",
    label: "Stage presets",
    href: "/settings/stage-presets",
    permission: "lists.manage",
    arrivesIn: "7.4",
  },
  {
    key: "custom-fields",
    label: "Custom fields",
    href: "/settings/custom-fields",
    permission: "lists.manage",
    arrivesIn: "3.2",
  },
  {
    key: "templates",
    label: "Templates",
    href: "/settings/templates",
    permission: "templates.manage",
    arrivesIn: "4.6",
  },
  {
    key: "drive",
    label: "Google Drive",
    href: "/settings/drive",
    permission: "drive.manage",
    arrivesIn: "8.3",
  },
];

const SETTINGS_PERMISSIONS_BY_ROLE: Record<ShellRole, readonly NavPermission[]> = {
  ceo: ["settings.manage", "lists.manage", "templates.manage", "drive.manage"],
  admin: ["lists.manage", "templates.manage"],
  staff: [],
};

export function settingsSectionsFor(role: ShellRole): readonly SettingsSection[] {
  const allowed = SETTINGS_PERMISSIONS_BY_ROLE[role];
  return SETTINGS_SECTIONS.filter((section) => allowed.includes(section.permission));
}

/** True when `pathname` is `href` or a route beneath it (used for the active nav state). */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
