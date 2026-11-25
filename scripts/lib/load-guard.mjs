/**
 * The 10:00 rush test's target guard (v7.0 unit 6; owner Q5–Q7, 14 Nov 2026: **staging only, never
 * production**). Everything the test does (make people, start their days, deactivate them) is
 * refused unless the app is staging, a preview of it or this machine, and the Supabase project is
 * not production's. Copied from `perf-probe.mjs`'s rule and tightened: a write needs both checks.
 */

/** Production's Supabase project (`maxoff-production`, Mumbai; README → "Deploying"). */
export const PRODUCTION_PROJECT_REF = "peshoflxypujbzecgwqq";

/** Throws unless `base` (the app) and `supabaseUrl` (its project) are safe to load. */
export function assertLoadTarget({ base, supabaseUrl }) {
  if (!supabaseUrl) throw new Error("SUPABASE_URL is required.");
  const project = new URL(supabaseUrl).hostname;
  if (
    project === `${PRODUCTION_PROJECT_REF}.supabase.co` ||
    project.includes(PRODUCTION_PROJECT_REF)
  ) {
    throw new Error(
      "Refused: that is production's Supabase project. The rush test runs on staging only.",
    );
  }
  const projectLocal = project === "127.0.0.1" || project === "localhost";
  if (!projectLocal && !project.endsWith(".supabase.co")) {
    throw new Error(`Refused: ${project} is not a Supabase project this test knows.`);
  }
  if (base === undefined) return;
  const { protocol, hostname } = new URL(base);
  if (/(^|\.)maxoff\.in$/.test(hostname) || hostname.includes("pixoraclips")) {
    throw new Error(`Refused: ${hostname} is production. The rush test runs on staging only.`);
  }
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const workers = protocol === "https:" && hostname.endsWith(".workers.dev");
  if (!local && !workers) {
    throw new Error(
      `Refused: ${hostname} is neither staging (*.workers.dev over https) nor this machine.`,
    );
  }
  if (local !== projectLocal) {
    throw new Error(
      "Refused: a local app must use the local Supabase, and staging its own project.",
    );
  }
}

/** The made-up people: fixed, recognisable, never routable (`.invalid` never delivers). */
export function loadPerson(n) {
  const nn = String(n).padStart(2, "0");
  return { email: `load-${nn}@rush-test.invalid`, fullName: `Rush test ${nn}` };
}

export function isLoadEmail(email) {
  return /^load-\d{2}@rush-test\.invalid$/.test(email ?? "");
}
