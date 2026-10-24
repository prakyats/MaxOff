/**
 * The Owner's Reports summary strip (major change 7, PP-reports-1): this month at a glance, from
 * the month report's own reads (`month_summary()` and the approved unpaid claims; no new table or
 * read). Each metric with something in it is a tile; the ones with nothing fold into one muted
 * line. Pure (`month-strip.test.ts`); money (the expenses tile) only reaches it on the Owner's
 * page, through `modules/expenses` (invariant 2).
 */

/** What one person's month adds to the strip (`MonthSummary`'s figures). */
export type StripPerson = {
  workingDays: number;
  daysWorked: number;
  leaveDays: number;
  absentDays: number;
  pendingDays: number;
  overtimeNotes: number;
  overtimeGranted: number;
};

export type StripTile = {
  key: "worked" | "waiting" | "overtime" | "expenses";
  figure: string;
  label: string;
  detail: string | null;
  href: string;
  /** The detail needs a look (leave or absence, or a decision that waits). */
  attention: boolean;
};

export type MonthStrip = { tiles: StripTile[]; quiet: string | null };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "4", "2½": halves are the only fractions a day count has. */
function days(value: number): string {
  const whole = Math.floor(value);
  if (Math.round((value - whole) * 2) !== 1) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

export function monthStrip(
  people: readonly StripPerson[],
  /** Approved claims not yet paid this month, in paise and count; null without `expenses.decide`. */
  unpaid: { paise: number; count: number; words: string } | null,
): MonthStrip {
  const sum = (pick: (person: StripPerson) => number) =>
    people.reduce((total, person) => total + pick(person), 0);
  const working = sum((person) => person.workingDays);
  const worked = sum((person) => person.daysWorked);
  const leave = sum((person) => person.leaveDays);
  const absent = sum((person) => person.absentDays);
  const waiting = sum((person) => person.pendingDays);
  const notes = sum((person) => person.overtimeNotes);
  const granted = sum((person) => person.overtimeGranted);
  const tiles: StripTile[] = [];
  const quiet: string[] = [];

  if (working > 0) {
    const away = [
      leave > 0 ? `${days(leave)} leave` : null,
      absent > 0 ? `${days(absent)} absent` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    tiles.push({
      key: "worked",
      figure: `${days(worked)} / ${days(working)}`,
      label: "Days worked (team)",
      detail: away || null,
      href: "/reports/month",
      attention: away.length > 0,
    });
  } else quiet.push("no working days yet");
  if (waiting > 0) {
    tiles.push({
      key: "waiting",
      figure: days(waiting),
      label: waiting === 1 ? "Day waiting for you" : "Days waiting for you",
      detail: "Review in Approvals",
      href: "/approvals",
      attention: true,
    });
  } else quiet.push("no days waiting");
  if (notes > 0) {
    tiles.push({
      key: "overtime",
      figure: String(notes),
      label: notes === 1 ? "Overtime note" : "Overtime notes",
      detail: granted > 0 ? `${granted} earned comp leave` : null,
      href: "/reports/month",
      attention: false,
    });
  } else quiet.push("no overtime notes");
  if (unpaid !== null) {
    if (unpaid.count > 0) {
      tiles.push({
        key: "expenses",
        figure: unpaid.words,
        label: "Expenses to pay",
        detail: plural(unpaid.count, "claim approved", "claims approved"),
        href: "/reports/month",
        attention: false,
      });
    } else quiet.push("no expenses to pay");
  }
  return {
    tiles,
    quiet: quiet.length > 0 ? `So far: ${listWords(quiet)}.` : null,
  };
}

/** "a", "a and b", "a, b and c". */
function listWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
