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
