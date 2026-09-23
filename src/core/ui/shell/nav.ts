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
  | "circle-user";

export type NavItem = {
  /** Stable id used by tests and e2e selectors. */
  key: string;
  label: string;
  href: string;
  icon: NavIconName;
  /** The permission the destination will check. `null` = every signed-in member. */
  permission: PermissionKey | null;
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
