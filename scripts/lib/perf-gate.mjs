// The perf probe's route list and its speed gate (v1.8, advisor #89 comment 6349679713), kept
// apart from `scripts/perf-probe.mjs` so the rules are unit-tested (`tests/perf-gate.test.ts`)
// without a network. Pure: no I/O, no clock.
//
// The gate (owner, #89 comment 6332543899: "no route slower than staging (the live v1.7.1) by
// >10 % or 100 ms"; read literally, either one fails a route), on the **warm** TTFB p50 (the
// kept-alive connection, the way a phone taps around):
//   1. a route's warm TTFB p50 above WARM_TTFB_P50_LIMIT_MS fails it;
//   2. when staging was probed too, a route slower than staging's by more than
//      SLOWER_THAN_STAGING_PCT percent OR more than SLOWER_THAN_STAGING_MS fails it;
//   3. a sample that answered with another status than the route's (a 500, a redirect to /login,
//      a timeout) fails it: a fast error page is not a fast route.

/** A route whose warm TTFB p50 is above this, in ms, fails. */
export const WARM_TTFB_P50_LIMIT_MS = 600;
/** A route slower than staging's warm TTFB p50 by more than this percentage fails. */
export const SLOWER_THAN_STAGING_PCT = 10;
/** A route slower than staging's warm TTFB p50 by more than this many ms fails. */
export const SLOWER_THAN_STAGING_MS = 100;

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
 * True when `candidate` is slower than `baseline` by more than SLOWER_THAN_STAGING_PCT percent
 * or more than SLOWER_THAN_STAGING_MS (the owner's literal "or").
 * @param {number} candidate
 * @param {number} baseline
 */
export function slowerThanStaging(candidate, baseline) {
  const delta = candidate - baseline;
  return delta > SLOWER_THAN_STAGING_MS || delta > (baseline * SLOWER_THAN_STAGING_PCT) / 100;
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
 *   verdict: "PASS" | "FAIL" | "SKIP",
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
  if (route.statusOk === false) reasons.push(`status ${route.statuses ?? "?"}`);
  if (warm > WARM_TTFB_P50_LIMIT_MS) {
    reasons.push(`warm p50 ${Math.round(warm)} > ${WARM_TTFB_P50_LIMIT_MS} ms`);
  }
  const compared =
    baseline !== undefined && baseline.skip === undefined && baseline.statusOk !== false
      ? baseline.warmP50
      : undefined;
  if (compared !== undefined && slowerThanStaging(warm, compared)) {
    const delta = warm - compared;
    const pct = compared > 0 ? Math.round((delta / compared) * 100) : Infinity;
    reasons.push(`+${Math.round(delta)} ms (+${pct} %) vs staging`);
  }
  return {
    name: route.name,
    verdict: reasons.length > 0 ? "FAIL" : "PASS",
    reasons,
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
  const probed = judgements.filter((j) => j.verdict !== "SKIP").length;
  const skipped = judgements.length - probed;
  const rule = `warm TTFB p50 ≤ ${WARM_TTFB_P50_LIMIT_MS} ms${
    compared
      ? ` and not slower than staging by > ${SLOWER_THAN_STAGING_PCT} % or > ${SLOWER_THAN_STAGING_MS} ms`
      : "; no staging compare in this run"
  }`;
  const tail = `${skipped > 0 ? `, ${skipped} skipped` : ""} (${rule}).`;
  if (failed.length === 0) return `**Speed gate: PASS**: all ${probed} probed routes pass${tail}`;
  return `**Speed gate: FAIL**: ${failed.length} of ${probed} probed routes fail${tail} Failing: ${failed
    .map((j) => `${j.name} (${j.reasons.join("; ")})`)
    .join(", ")}.`;
}
