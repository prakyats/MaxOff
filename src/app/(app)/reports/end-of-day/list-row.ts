/**
 * The End of day list's geometry, shared by the page and its loading screen (ARCHITECTURE §14.1:
 * a skeleton traces its own screen), so the two cannot drift apart: the bordered list, and each
 * row's height and padding around its two lines (the day, then live / saved / not saved).
 */
export const EOD_LIST_CLASS =
  "border-border divide-border divide-y overflow-hidden rounded-lg border md:max-w-2xl";

export const EOD_ROW_CLASS = "flex min-h-14 items-center gap-3 px-4 py-3";
