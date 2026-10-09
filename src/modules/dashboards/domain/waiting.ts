/**
 * How long a decision has waited for the Owner (the Owner's Today refresh, owner 2026-10-09; ROADMAP
 * 6b.7): each approval row on Today says "Waiting 3 h" or "Waiting 4 days" on its own line (the
 * owner's preview review, 2026-10-09), counted from when the item reached the Owner. Muted under a
 * day, amber from one day, red from three: the words always carry the meaning, the colour only
 * adds to it (ARCHITECTURE §14.1). Pure, so it is unit-tested; the clock is the caller's
 * (`core/time`'s `systemClock`), never read here.
 */

export type WaitingTone = "muted" | "attention" | "danger";

/** A row's waiting words and their colour. */
export type Waiting = { label: string; tone: WaitingTone };

const HOUR_MS = 3_600_000;

/** From one day: amber ("have a look"). */
export const WAITING_ATTENTION_HOURS = 24;
/** From three days: red (a decision overdue by any reading). */
export const WAITING_DANGER_HOURS = 72;

/**
 * "Waiting under 1 h", "Waiting 3 h" (under a day), "Waiting 1 day", "Waiting 4 days" (whole days,
 * rounded down), with its tone: the row's second meta line, alone. An instant in the future (a
 * clock a little ahead) counts as now.
 */
export function waitingFor(since: string, now: Date): Waiting {
  const hours = Math.max(0, (now.getTime() - Date.parse(since)) / HOUR_MS);
  const tone: WaitingTone =
    hours >= WAITING_DANGER_HOURS
      ? "danger"
      : hours >= WAITING_ATTENTION_HOURS
        ? "attention"
        : "muted";
  if (hours < 1) return { label: "Waiting under 1 h", tone };
  if (hours < 24) return { label: `Waiting ${Math.floor(hours)} h`, tone };
  const days = Math.floor(hours / 24);
  return { label: days === 1 ? "Waiting 1 day" : `Waiting ${days} days`, tone };
}

/**
 * When an item reached the Owner: the latest of the moments given (null ones skipped), or null when
 * none is known. A task waiting for the Owner reached them at the later of its hand-in and the
 * approving Admin's approval of it (an Admin approves after the hand-in; with no Admin step the
 * hand-in itself moves it to the Owner).
 */
export function reachedAt(...instants: readonly (string | null | undefined)[]): string | null {
  let latest: string | null = null;
  for (const instant of instants) {
    if (!instant) continue;
    if (latest === null || Date.parse(instant) > Date.parse(latest)) latest = instant;
  }
  return latest;
}
