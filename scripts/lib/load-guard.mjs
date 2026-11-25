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
  // Production: its domain, and its own Worker (`maxoff.<account>.workers.dev`, which redirects to
  // app.maxoff.in). Staging's Worker shares the account's subdomain, so the account's name alone
  // says nothing (Preview run 45673706796 refused staging that way).
  const [worker] = hostname.split(".");
  if (
    /(^|\.)maxoff\.in$/.test(hostname) ||
    (hostname.endsWith(".workers.dev") && worker === "maxoff")
  ) {
    throw new Error(`Refused: ${hostname} is production. The rush test runs on staging only.`);
  }
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  // Staging's Worker (`maxoff-staging`) or a branch preview of it (`<branch>-maxoff-staging`).
  const staging =
    protocol === "https:" &&
    hostname.endsWith(".workers.dev") &&
    (worker === "maxoff-staging" || (worker ?? "").endsWith("-maxoff-staging"));
  if (!local && !staging) {
    throw new Error(
      `Refused: ${hostname} is neither staging (maxoff-staging, or a preview of it, over https) nor this machine.`,
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
