/**
 * `GET /diagnostics/digest` (5B slice 7, owner decision 2026-10-03): the Owner's morning summary
 * rendered from live data, on local and staging builds (branch previews are staging builds), never
 * on production. Decided at **runtime** on top of the build: the build's `NEXT_PUBLIC_APP_ENV`
 * (inlined by Next) must be `local` or `staging`, the same variable read at runtime through a
 * dynamic key (never inlined) must not say anything else, and `CANONICAL_HOST`, the Worker var
 * only the production environment has (`wrangler.jsonc`), must be unset. Any one of them saying
 * production answers 404. Pure, unit-tested.
 */
export type DigestDiagnosticEnv = {
  /** `NEXT_PUBLIC_APP_ENV` as the build inlined it. */
  buildAppEnv: string | undefined;
  /** The same variable read at runtime. */
  runtimeAppEnv: string | undefined;
  /** The Worker's `CANONICAL_HOST` at runtime (production only). */
  canonicalHost: string | undefined;
};

const OPEN_ENVS: readonly string[] = ["local", "staging"];

export function isDigestDiagnosticEnabled(env: DigestDiagnosticEnv): boolean {
  if (!env.buildAppEnv || !OPEN_ENVS.includes(env.buildAppEnv)) return false;
  const runtime = env.runtimeAppEnv?.trim();
  if (runtime && !OPEN_ENVS.includes(runtime)) return false;
  return !env.canonicalHost?.trim();
}

/**
 * Read for each request. Next inlines only the literal `process.env.NEXT_PUBLIC_*`; read through
 * this alias, the values are the Worker's own at runtime (OpenNext copies its vars into
 * `process.env`).
 */
export function digestDiagnosticEnv(buildAppEnv: string | undefined): DigestDiagnosticEnv {
  const runtime: Readonly<Record<string, string | undefined>> = process.env;
  return {
    buildAppEnv,
    runtimeAppEnv: runtime.NEXT_PUBLIC_APP_ENV,
    canonicalHost: runtime.CANONICAL_HOST,
  };
}
