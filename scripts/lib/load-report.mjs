/**
 * The 10:00 rush test's numbers and verdict (v7.0 unit 6). **Pass (owner Q6, 14 Nov 2026):**
 * every Start day goes through, none is doubled, and 19 of 20 people wait under 3 s.
 */

/** The p-th percentile (0..100) by nearest rank, or null for no values. */
export function percentile(values, p) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** p50, p95 and the max of one step's times. */
export function stepSummary(values) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: percentile(values, 100),
  };
}

export const WAIT_LIMIT_MS = 3000;

/**
 * `people`: one entry per person, `{ ok, status, waitMs, rows, started }`, where `waitMs` is the
 * tap to the screen showing the started day (the Start day call plus the home screen read again),
 * `rows` the number of that person's days today and `started` the number of `started` events.
 */
export function verdict(people, { limitMs = WAIT_LIMIT_MS, allowedSlow = 1 } = {}) {
  const failed = people.filter((p) => !p.ok);
  const doubled = people.filter((p) => p.rows !== 1 || p.started !== 1);
  const slow = people.filter((p) => !(p.waitMs < limitMs));
  const pass =
    people.length > 0 && failed.length === 0 && doubled.length === 0 && slow.length <= allowedSlow;
  return {
    pass,
    people: people.length,
    failed: failed.length,
    doubled: doubled.length,
    underLimit: people.length - slow.length,
    wait: stepSummary(people.map((p) => p.waitMs)),
  };
}

/** The report's lines, for the run's log and the release notes. */
export function reportLines(result, steps) {
  const ms = (v) => (v === null ? "-" : `${Math.round(v)} ms`);
  const lines = [
    `| Step | n | p50 | p95 | max |`,
    `|---|---|---|---|---|`,
    ...Object.entries(steps).map(
      ([name, s]) => `| ${name} | ${s.n} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.max)} |`,
    ),
    "",
    `People: ${result.people} · failed: ${result.failed} · doubled: ${result.doubled} · under 3 s: ${result.underLimit} of ${result.people}`,
    `Verdict: ${result.pass ? "PASS" : "FAIL"}`,
  ];
  return lines;
}

/** "200×7 · 400×13": how often each value came, most often first (ties in first-seen order). */
export function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `${value}×${count}`)
    .join(" · ");
}

/**
 * A refused Start day as one short line: its HTTP status and PostgREST's error (`app.fail`'s code
 * and sentence), never more than 160 characters.
 */
export function refusalOf(status, body) {
  let words = String(body ?? "");
  try {
    const parsed = JSON.parse(words);
    words = [parsed.message, parsed.details].filter(Boolean).join(": ");
  } catch {
    // Not JSON: the body as it came.
  }
  return `${status} ${words}`.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Minutes since IST midnight for an instant (ms since the epoch). IST has no daylight saving. */
export function istMinutes(epochMs) {
  const ist = Math.floor((epochMs + 330 * 60_000) / 60_000);
  return ((ist % 1440) + 1440) % 1440;
}

/**
 * Whether the Start days may go out now (Preview 45674894596): they must all land on one IST day,
 * after 22:00 IST and no later than 23:45 IST, so the whole spread (and its stragglers) stays
 * before midnight, when a day's Start belongs to the next date. Returns the refusal, or null.
 */
export function rushWindowRefusal(epochMs, spreadMs) {
  const start = istMinutes(epochMs);
  const end = start + Math.ceil(spreadMs / 60_000);
  if (start < 22 * 60) return "Refused: the rush test starts after 22:00 IST.";
  if (end > 23 * 60 + 45) {
    return "Refused: the Start days would end after 23:45 IST and could cross midnight into the next IST date. Run it between 22:00 and 23:45 IST.";
  }
  return null;
}
