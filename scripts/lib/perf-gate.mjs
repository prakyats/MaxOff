// The perf probe's route list and its speed gate (v1.8, advisor #89 comment 6349679713), kept
// apart from `scripts/perf-probe.mjs` so the rules are unit-tested (`tests/perf-gate.test.ts`)
// without a network. Pure: no I/O, no clock.
//
// The gate (owner, #89 comment 6332543899: "no route slower than staging (the live v1.7.1) by
// >10 % or 100 ms"; the advisor's reading, 2026-10-23, so a few ms of noise on a tiny route does
// not fail it; the 50 ms floor is for the owner to confirm), on the **warm** TTFB p50 (the
// kept-alive connection, the way a phone taps around):
//   1. a route's warm TTFB p50 above WARM_TTFB_P50_LIMIT_MS fails it;
//   2. when staging was probed too, a route slower than staging's by more than
//      SLOWER_THAN_STAGING_MS fails it, and so does one slower by more than
//      SLOWER_THAN_STAGING_PCT percent AND at least SLOWER_PCT_FLOOR_MS;
//      more than SLOWER_THAN_STAGING_PCT percent but under SLOWER_PCT_FLOOR_MS is a WARN: shown,
//      not failing;
//   3. a sample that answered with another status than the route's (a 500, a redirect to /login,
//      a timeout) fails it: a fast error page is not a fast route.
// Routes in NOT_GATED (the warm-up ping, the static file the CDN serves and the Worker's bare 404:
// hosting, not MaxOff code; advisor 2026-10-23, owner to confirm) keep their timing out of the
// verdict: shown as INFO. Their status is still judged, so a 5xx, a redirect to /login or a
// timeout on them still fails.

/** A route whose warm TTFB p50 is above this, in ms, fails. */
export const WARM_TTFB_P50_LIMIT_MS = 600;
/** A route slower than staging's warm TTFB p50 by more than this percentage fails. */
export const SLOWER_THAN_STAGING_PCT = 10;
/** A route slower than staging's warm TTFB p50 by more than this many ms fails. */
export const SLOWER_THAN_STAGING_MS = 100;
/** The percentage rule fails a route only when it is also at least this many ms slower. */
export const SLOWER_PCT_FLOOR_MS = 50;
/** Shown in the table, left out of the verdict. */
export const NOT_GATED = new Set(["/api/warm", "static (no Worker)", "404 (Worker, no data)"]);

/** @typedef {"owner" | "admin" | "staff"} Role */
/** @typedef {"task" | "client" | "project" | "projectClient" | "person"} IdKey */
/** @typedef {Partial<Record<IdKey, string | null>>} Ids */
/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   roles: readonly Role[],
 *   needs?: readonly IdKey[],
 *   what?: string,
 * }} MemberRoute
 */

const ALL = /** @type {const} */ (["owner", "admin", "staff"]);
const LEADS = /** @type {const} */ (["owner", "admin"]);

/** Role labels as people read them (`ROLE_LABELS`: Staff is shown as "Crew"). */
const ROLE_NAMES = { owner: "the Owner", admin: "an Admin", staff: "the Crew" };

/**
 * Every main signed-in route: each role's tabs and More items (`src/core/ui/shell/nav.ts`:
 * `NAV_BY_ROLE`, the bar, the More sheet, Me and the bell), then one record of each kind the
 * member can see. `roles` is who can open it; `tests/perf-gate.test.ts` proves the tabs match
 * the nav, so a new tab cannot slip out of the probe. `:key` is filled from the ids the probe
 * reads with the member's own session.
 * @type {readonly MemberRoute[]}
 */
export const MEMBER_ROUTES = [
  { name: "/today", path: "/today", roles: LEADS },
  { name: "/my-day", path: "/my-day", roles: ["staff"] },
  { name: "/approvals", path: "/approvals", roles: LEADS },
  { name: "/tasks", path: "/tasks", roles: ALL },
  { name: "/calendar", path: "/calendar", roles: ALL },
  { name: "/clients", path: "/clients", roles: LEADS },
  { name: "/people", path: "/people", roles: LEADS },
  { name: "/reports", path: "/reports", roles: LEADS },
  { name: "/leave", path: "/leave", roles: ["admin", "staff"] },
  { name: "/leave/attendance", path: "/leave/attendance", roles: ["admin", "staff"] },
  { name: "/leave/extra-work", path: "/leave/extra-work", roles: ["admin", "staff"] },
  { name: "/leave/expenses", path: "/leave/expenses", roles: ["admin", "staff"] },
  { name: "/settings", path: "/settings", roles: LEADS },
  { name: "/settings/templates", path: "/settings/templates", roles: LEADS },
  { name: "/me", path: "/me", roles: ALL },
  { name: "/notifications", path: "/notifications", roles: ALL },
  { name: "a task", path: "/tasks/:task", roles: ALL, needs: ["task"], what: "task" },
  { name: "a client", path: "/clients/:client", roles: LEADS, needs: ["client"], what: "client" },
  {
    name: "a project",
    path: "/clients/:projectClient/projects/:project",
    roles: LEADS,
    needs: ["project", "projectClient"],
    what: "project",
  },
  { name: "a person", path: "/people/:person", roles: LEADS, needs: ["person"], what: "person" },
  { name: "/diagnostics/timing", path: "/diagnostics/timing", roles: ALL },
];

/**
 * The member routes for one role: the ones to probe with their real path, and the ones skipped
 * with the reason the table prints.
 * @param {Role} role
 * @param {Ids} ids
 * @returns {{ name: string, path?: string, skip?: string }[]}
 */
export function planMemberRoutes(role, ids) {
  return MEMBER_ROUTES.map((route) => {
    if (!route.roles.includes(role)) {
      return { name: route.name, skip: `${ROLE_NAMES[role]} can't open it` };
    }
    const missing = (route.needs ?? []).filter((key) => !ids[key]);
    if (missing.length > 0) {
      return { name: route.name, skip: `no ${route.what ?? "record"} this member can see` };
    }
    const path = route.path.replace(/:([A-Za-z]+)/g, (_, key) =>
      String(ids[/** @type {IdKey} */ (key)]),
    );
    return { name: route.name, path };
  });
}

/**
 * The median the probe has always printed: the middle sample, the upper one of an even count.
 * @param {readonly number[]} values
 */
export function median(values) {
  return values.length === 0
    ? 0
    : ([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0);
}

/**
 * How much slower `candidate` is than `baseline`: "fail" past SLOWER_THAN_STAGING_MS, or past
 * SLOWER_THAN_STAGING_PCT percent with at least SLOWER_PCT_FLOOR_MS; "warn" past the percentage
 * under the floor; otherwise "ok".
 * @param {number} candidate
 * @param {number} baseline
 * @returns {"ok" | "warn" | "fail"}
 */
export function slowerThanStaging(candidate, baseline) {
  const delta = candidate - baseline;
  if (delta > SLOWER_THAN_STAGING_MS) return "fail";
  if (delta > (baseline * SLOWER_THAN_STAGING_PCT) / 100) {
    return delta >= SLOWER_PCT_FLOOR_MS ? "fail" : "warn";
  }
  return "ok";
}

/**
 * @typedef {{
 *   name: string,
 *   skip?: string,
 *   statusOk?: boolean,
 *   statuses?: string,
 *   warmP50?: number,
 * }} RouteSummary
 */
/**
 * @typedef {{
 *   name: string,
 *   verdict: "PASS" | "WARN" | "FAIL" | "SKIP" | "INFO",
 *   reasons: string[],
 *   warmP50?: number,
 *   baselineP50?: number,
 *   skip?: string,
 * }} Judgement
 */

/**
 * One route's verdict.
 * @param {RouteSummary} route
 * @param {RouteSummary | undefined} [baseline] staging's row for the same route, when probed
 * @returns {Judgement}
 */
export function judgeRoute(route, baseline) {
  if (route.skip !== undefined) {
    return { name: route.name, verdict: "SKIP", reasons: [], skip: route.skip };
  }
  const warm = route.warmP50 ?? 0;
  /** @type {string[]} */
  const reasons = [];
  /** @type {string[]} */
  const warnings = [];
  if (route.statusOk === false) reasons.push(`status ${route.statuses ?? "?"}`);
  if (warm > WARM_TTFB_P50_LIMIT_MS) {
    reasons.push(`warm p50 ${Math.round(warm)} > ${WARM_TTFB_P50_LIMIT_MS} ms`);
  }
  const compared =
    baseline !== undefined && baseline.skip === undefined && baseline.statusOk !== false
      ? baseline.warmP50
      : undefined;
  const slower = compared !== undefined ? slowerThanStaging(warm, compared) : "ok";
  if (compared !== undefined && slower !== "ok") {
    const delta = warm - compared;
    const pct = compared > 0 ? Math.round((delta / compared) * 100) : Infinity;
    (slower === "fail" ? reasons : warnings).push(
      `+${Math.round(delta)} ms (+${pct} %) vs staging`,
    );
  }
  const timingOnly = NOT_GATED.has(route.name);
  if (timingOnly) {
    // Only the status counts: the timing reasons move to the shown, unjudged ones.
    const status = reasons.filter((r) => r.startsWith("status "));
    warnings.unshift(...reasons.filter((r) => !r.startsWith("status ")));
    reasons.length = 0;
    reasons.push(...status);
  }
  const verdict = timingOnly
    ? reasons.length > 0
      ? "FAIL"
      : "INFO"
    : reasons.length > 0
      ? "FAIL"
      : warnings.length > 0
        ? "WARN"
        : "PASS";
  return {
    name: route.name,
    verdict,
    reasons: verdict === "WARN" || verdict === "INFO" ? [...reasons, ...warnings] : reasons,
    warmP50: warm,
    ...(compared !== undefined ? { baselineP50: compared } : {}),
  };
}

/**
 * Every route's verdict, matched to staging's by name when a baseline is given.
 * @param {readonly RouteSummary[]} routes
 * @param {readonly RouteSummary[] | null} [baseline]
 * @returns {Judgement[]}
 */
export function judgeRun(routes, baseline) {
  const byName = new Map((baseline ?? []).map((row) => [row.name, row]));
  return routes.map((route) => judgeRoute(route, byName.get(route.name)));
}

/**
 * The one line under the table: the gate's verdict and what failed it.
 * @param {readonly Judgement[]} judgements
 * @param {{ compared: boolean }} options
 */
export function summaryLine(judgements, { compared }) {
  const failed = judgements.filter((j) => j.verdict === "FAIL");
  const warned = judgements.filter((j) => j.verdict === "WARN");
  const probed = judgements.filter((j) => j.verdict !== "SKIP").length;
  const skipped = judgements.length - probed;
  const rule = `warm TTFB p50 ≤ ${WARM_TTFB_P50_LIMIT_MS} ms${
    compared
      ? ` and not slower than staging by > ${SLOWER_THAN_STAGING_MS} ms, or by > ${SLOWER_THAN_STAGING_PCT} % and ≥ ${SLOWER_PCT_FLOOR_MS} ms`
      : "; no staging compare in this run"
  }`;
  const warns =
    warned.length > 0
      ? ` WARN (> ${SLOWER_THAN_STAGING_PCT} % but < ${SLOWER_PCT_FLOOR_MS} ms): ${warned
          .map((j) => `${j.name} (${j.reasons.join("; ")})`)
          .join(", ")}.`
      : "";
  const tail = `${skipped > 0 ? `, ${skipped} skipped` : ""} (${rule}).`;
  if (failed.length === 0) {
    return `**Speed gate: PASS**: no probed route fails, of ${probed}${tail}${warns}`;
  }
  return `**Speed gate: FAIL**: ${failed.length} of ${probed} probed routes fail${tail} Failing: ${failed
    .map((j) => `${j.name} (${j.reasons.join("; ")})`)
    .join(", ")}.${warns}`;
}
