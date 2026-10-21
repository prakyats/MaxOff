import { SETTINGS_GROUPS, settingsSectionsFor, type SettingsSection } from "@/core/ui/shell/nav";
import type { ShellRole } from "@/core/ui/shell/viewer";

/**
 * The Settings page's header and its two lists, shared by the page and its loading screen
 * (ARCHITECTURE §14.1: a skeleton traces its own screen), so the two cannot drift apart: the
 * role's header line, the sections in their groups (N3: a heading, then rows of a name and one
 * line), and the Help and troubleshooting block under them.
 */

/** The role's sections in their groups, in order; a group with nothing for the role is left out. */
export function settingsGroupsFor(
  role: ShellRole,
): { key: string; label: string; sections: readonly SettingsSection[] }[] {
  const sections = settingsSectionsFor(role);
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: sections.filter((section) => section.group === group.key),
  })).filter((group) => group.sections.length > 0);
}

/** The header line for the reader's role: the Owner's control centre, or an Admin's lists. */
export function settingsDescription(role: ShellRole): string {
  return role === "owner"
    ? "Everything configurable lives here: company, days off, thresholds, notifications, lists, fields, templates and integrations."
    : "The lists and templates you may edit, and who on your tasks can't be reached. Company settings, days off, thresholds and the team are the Owner's.";
}

/**
 * N3 (v1.8 V4): the sections in their groups (`SETTINGS_GROUPS`), each group a heading over one
 * bordered list of rows, on a phone and a laptop alike; each row is the section's name and one
 * line saying what it holds. From `lg` the groups sit two to a row.
 */
export const SETTINGS_LIST_CLASS =
  "grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2";

/** A group's heading: small, quiet, above its list. */
export const GROUP_HEADING_CLASS = "text-muted-foreground mb-2 px-1 text-sm font-medium";

/** A group's list of rows. */
export const GROUP_LIST_CLASS =
  "border-border bg-card divide-border divide-y overflow-hidden rounded-card border";

/** A row: the name over its one line, beside the chevron (or the "Coming soon" pill). */
export const SECTION_ROW_CLASS = "relative flex min-h-16 items-center gap-2 px-4 py-2.5";

/** The name, inside the row's link. */
export const SECTION_LABEL_CLASS = "block truncate text-sm leading-5 font-medium";

/** The one line under the name: what the section holds; one line at every width. */
export const SECTION_LINE_CLASS = "text-muted-foreground block truncate text-sm leading-5";

/** Help and troubleshooting (ROADMAP 6b.14): one bordered row under the sections. */
export const HELP_LIST_CLASS =
  "border-border mt-6 overflow-hidden rounded-lg border md:max-w-md md:rounded-xl";

/** The row: two lines (what opens, and for whom) beside a chevron. */
export const HELP_ROW_CLASS = "flex min-h-14 items-center gap-2 px-4 py-2";
