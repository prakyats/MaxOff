import type { ShellRole } from "@/core/ui/shell/viewer";

/**
 * The Settings page's header and its two lists, shared by the page and its loading screen
 * (ARCHITECTURE §14.1: a skeleton traces its own screen), so the two cannot drift apart: the
 * role's header line, the sections list (a list of 56px rows on a phone, a grid of cards from
 * `md` up), each section's shell and tappable line, its description, and the Help and
 * troubleshooting block under the list.
 */

/** The header line for the reader's role: the Owner's control centre, or an Admin's lists. */
export function settingsDescription(role: ShellRole): string {
  return role === "owner"
    ? "Everything configurable lives here: company, days off, thresholds, notifications, lists, fields, templates and integrations."
    : "The lists and templates you may edit, and who on your tasks can't be reached. Company settings, days off, thresholds and the team are the Owner's.";
}

export const SETTINGS_LIST_CLASS =
  "border-border divide-border divide-y overflow-hidden rounded-lg border md:grid md:grid-cols-2 md:gap-3 md:divide-y-0 md:overflow-visible md:rounded-none md:border-0 lg:grid-cols-3";

/** The row itself on a phone; the card from `md` up. */
export const SECTION_SHELL_CLASS =
  "relative h-full md:rounded-xl md:border md:border-border md:bg-card md:transition-colors";

/** The tappable line of a section (its label and arrow, or its label and "Coming soon"). */
export const SECTION_LINE_CLASS =
  "flex min-h-14 items-center gap-2 px-4 outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/** A section that opens: its line from `md` up starts the card. */
export const SECTION_READY_LINE_CLASS = "md:min-h-0 md:pt-4";

/** A section not built yet: its label and badge wrap at large text. */
export const SECTION_SOON_LINE_CLASS = "flex-wrap py-2 after:hidden md:min-h-0 md:pt-4 md:pb-0";

/** A section's description: the card's second part, from `md` up only. */
export const SECTION_DESCRIPTION_CLASS =
  "text-muted-foreground hidden px-4 pt-1.5 pb-4 text-sm md:block";

/** Help and troubleshooting (ROADMAP 6b.14): one bordered row under the sections. */
export const HELP_LIST_CLASS =
  "border-border mt-6 overflow-hidden rounded-lg border md:max-w-md md:rounded-xl";

/** The row: two lines (what opens, and for whom) beside a chevron. */
export const HELP_ROW_CLASS = "flex min-h-14 items-center gap-2 px-4 py-2";
