import { settingsSectionsFor, type SettingsSection } from "@/core/ui/shell/nav";
import type { ShellRole } from "@/core/ui/shell/viewer";

/**
 * The Settings page's header and its two lists, shared by the page and its loading screen
 * (ARCHITECTURE §14.1: a skeleton traces its own screen), so the two cannot drift apart: the
 * role's header line, the sections in their groups (N3: a heading, then rows of a name and one
 * line), and the Help and troubleshooting block under them.
 */

/**
 * The Settings groups, named by what the reader sees in them (PP-admin-9, owner 2026-10-22): the
 * company and its working days, the team (who can't be reached, job titles), then the lists,
 * fields and templates, and the integrations. A group that would hold one section for the role
 * folds into its neighbour (`FOLDED_LABEL` names the two together).
 */
const GROUPS: readonly { key: string; label: string; sections: readonly string[] }[] = [
  {
    key: "company",
    label: "Company and working days",
    sections: ["company", "days-off", "thresholds"],
  },
  { key: "team", label: "Team", sections: ["notifications", "job-titles"] },
  {
    key: "lists",
    label: "Lists, fields and templates",
    sections: ["expenses", "task-types", "custom-fields", "templates"],
  },
  { key: "integrations", label: "Integrations", sections: ["drive"] },
];

/** A group's heading once a one-section neighbour has folded into it (by the two keys). */
const FOLDED_LABEL: Readonly<Record<string, string>> = {
  "lists+integrations": "Lists, templates and integrations",
  "company+team": "Company and team",
  "team+lists": "Team, lists and templates",
};

/** The role's sections in their groups, in order; a group with nothing for the role is left out. */
export function settingsGroupsFor(
  role: ShellRole,
): { key: string; label: string; sections: readonly SettingsSection[] }[] {
  const sections = settingsSectionsFor(role);
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const groups = GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    sections: group.sections.flatMap((key) => {
      const section = byKey.get(key);
      return section ? [section] : [];
    }),
  })).filter((group) => group.sections.length > 0);
  // A section in no group (a new one) joins the last group rather than vanish.
  const placed = new Set(groups.flatMap((group) => group.sections.map((section) => section.key)));
  const rest = sections.filter((section) => !placed.has(section.key));
  const last = groups.at(-1);
  if (last && rest.length > 0) last.sections = [...last.sections, ...rest];
  // Fold a one-section group into its neighbour: the one before it, or after it when first.
  const folded: typeof groups = [];
  for (const group of groups) {
    const previous = folded.at(-1);
    if (group.sections.length === 1 && previous) {
      previous.sections = [...previous.sections, ...group.sections];
      previous.label = FOLDED_LABEL[`${previous.key}+${group.key}`] ?? previous.label;
      previous.key = `${previous.key}+${group.key}`;
      continue;
    }
    folded.push({ ...group });
  }
  const [first, second, ...others] = folded;
  if (first && second && first.sections.length === 1) {
    return [
      {
        key: `${first.key}+${second.key}`,
        label: FOLDED_LABEL[`${first.key}+${second.key}`] ?? second.label,
        sections: [...first.sections, ...second.sections],
      },
      ...others,
    ];
  }
  return folded;
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
  "border-border bg-card shadow-raised divide-border divide-y overflow-hidden rounded-card border";

/** A row: the name over its one line, beside the chevron (or the "Coming soon" pill). */
export const SECTION_ROW_CLASS = "relative flex min-h-16 items-center gap-2 px-4 py-2.5";

/** The name, inside the row's link. */
export const SECTION_LABEL_CLASS = "block truncate text-sm leading-5 font-medium";

/** The one line under the name: what the section holds; one line at every width. */
export const SECTION_LINE_CLASS = "text-muted-foreground block truncate text-sm leading-5";

/**
 * Help (ROADMAP 6b.14; PP-settings-2: its own group, "Help", under the others): one row in a
 * group's list, opening the guide.
 */
export const HELP_GROUP_CLASS = "mt-6 md:max-w-md";
export const HELP_LIST_CLASS = GROUP_LIST_CLASS;

/** The row: two lines (what opens, and for whom) beside a chevron. */
export const HELP_ROW_CLASS = "flex min-h-14 items-center gap-2 px-4 py-2";
