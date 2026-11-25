import { addISTDays, formatIST, type ISODate, istDayStart } from "@/core/time";

/**
 * The "End not recorded" group's line about yesterday (kickoff 6 decision 24, amended
 * 2026-10-08), shared by the board and its loading screen (ARCHITECTURE §14.1: the skeleton draws
 * the same line, so the rows under it do not move when the page arrives).
 */

/**
 * Whether the board shows yesterday: its `group` search param, read as the page reads it
 * (`parsePeopleGroup`: the first value; anything else is "all").
 */
export function showsYesterday(group: string | readonly string[] | null | undefined): boolean {
  const first = typeof group === "string" ? group : group?.[0];
  return first === "end_not_recorded";
}

export function yesterdayLine(today: ISODate): string {
  const day = formatIST(istDayStart(addISTDays(today, -1)), "EEE d MMM");
  return `Yesterday, ${day}: started, End day not recorded, not decided yet.`;
}

export const YESTERDAY_LINE_CLASS = "text-muted-foreground mb-4 text-sm";
