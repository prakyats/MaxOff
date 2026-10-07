/**
 * What the stand-in screens say until their real screens arrive (kickoff 3c amendment (3e),
 * "friendly placeholder copy before any invite"): what the screen will be for and that it is
 * coming, in the app's voice (PRODUCT §1-§2: plain, short, second person). No task numbers and
 * no build words reach a user; the roadmap task that replaces each screen is named in a comment.
 *
 * `stand-ins.test.ts` keeps the words plain, and `e2e/mobile.spec.ts` reads each screen at 375
 * and 430px against this file.
 */
export type StandIn = {
  /** The page header's line (a phone shows the title only, ARCHITECTURE §14.1). */
  description: string;
  /** The empty state: what is coming. */
  title: string;
  /** The empty state's line: what the screen will be for, and what to use until then. */
  message: string;
};

export const STAND_INS = {
  /** The calendar, every role (task 6.4). */
  calendar: {
    description: "Shoots, meetings, leave and holidays, by day, week and month.",
    title: "The calendar is coming soon",
    message:
      "Shoots, meetings, approved leave and holidays will all be here, by day, week and month.",
  },
} as const satisfies Record<string, StandIn>;

/**
 * A stand-in screen's header line: what `PlaceholderPage` writes (greeting the member on the
 * dashboards) and what its loading screen repeats, so the header does not change when the page
 * arrives (4C review S7, ARCHITECTURE §14.1).
 */
export function standInDescription(copy: StandIn, greet?: string): string {
  return greet ? `Hello, ${greet}. ${copy.description}` : copy.description;
}
