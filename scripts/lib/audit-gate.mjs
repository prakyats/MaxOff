/**
 * The dependency-audit gate (v7.5 plan §2.1, advisor 26 Nov 2026): what `pnpm audit --prod --json`
 * reports, against `scripts/audit-allowlist.json`. Pure, so the rules are unit-tested
 * (`tests/audit-gate.test.ts`).
 *
 * The gate fails on a **critical** advisory that is not allowlisted, and on an allowlist entry
 * past its expiry (a known advisory is never waved through for good). An entry that no longer
 * matches anything is reported, so the list shrinks when a fix lands.
 */

/** @typedef {{ id: string; module: string; severity: string; title: string; patched: string; url: string }} Advisory */
/** @typedef {{ id: string; module: string; expires: string; reason: string }} Allowed */

/** The advisories in `pnpm audit --json`'s answer, by their GitHub id. */
export function advisoriesOf(report) {
  return Object.values(report?.advisories ?? {}).map((advisory) => ({
    id: advisory.github_advisory_id,
    module: advisory.module_name,
    severity: advisory.severity,
    title: advisory.title,
    patched: advisory.patched_versions,
    url: advisory.url,
  }));
}

/**
 * @param {Advisory[]} advisories
 * @param {Allowed[]} allowlist
 * @param {string} today an ISO date, `YYYY-MM-DD`
 * @param {readonly string[]} failOn the severities that fail the gate
 */
export function gate(advisories, allowlist, today, failOn = ["critical"]) {
  const allowed = new Map(allowlist.map((entry) => [entry.id, entry]));
  const failing = advisories.filter(
    (advisory) => failOn.includes(advisory.severity) && !allowed.has(advisory.id),
  );
  const expired = allowlist.filter((entry) => entry.expires < today);
  const seen = new Set(advisories.map((advisory) => advisory.id));
  const stale = allowlist.filter((entry) => !seen.has(entry.id));
  return { ok: failing.length === 0 && expired.length === 0, failing, expired, stale };
}

/** A Markdown summary of the high and critical advisories (the weekly issue's body). */
export function summary(advisories, allowlist, today) {
  const allowed = new Map(allowlist.map((entry) => [entry.id, entry]));
  const serious = advisories
    .filter((advisory) => advisory.severity === "critical" || advisory.severity === "high")
    .sort((a, b) =>
      a.severity === b.severity
        ? a.module.localeCompare(b.module)
        : a.severity === "critical"
          ? -1
          : 1,
    );
  const lines = [
    `Dependency audit (\`pnpm audit --prod\`), ${today}: ${serious.length} high or critical.`,
    "",
    "| Severity | Package | Advisory | Fixed in | Allowlisted |",
    "|---|---|---|---|---|",
    ...serious.map((advisory) => {
      const entry = allowed.get(advisory.id);
      return `| ${advisory.severity} | ${advisory.module} | [${advisory.id}](${advisory.url}) ${advisory.title} | ${advisory.patched} | ${entry ? `until ${entry.expires}: ${entry.reason}` : "no"} |`;
    }),
  ];
  return lines.join("\n");
}
