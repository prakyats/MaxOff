/**
 * The version Me's "Help & troubleshooting" shows (5B decision 4; B11, UX review 2026-10-21):
 * the release tag a production build was made from (`v1.7.1`); a staging or preview build
 * `staging · 36b4b95` (its environment and the 7-character commit, never the branch name);
 * a CI build with no environment `main · 36b4b95`; else "local". Read from the build's
 * environment (GitHub Actions sets `GITHUB_REF_TYPE`, `GITHUB_REF_NAME` and `GITHUB_SHA` on
 * every step; deploy.yml and preview.yml set `NEXT_PUBLIC_APP_ENV`, and deploy.yml's staging build
 * `APP_COMMIT_SHA`, the commit it really built) by `next.config.ts`, which
 * inlines it as `NEXT_PUBLIC_APP_VERSION`: nothing to configure, no secret.
 */
export function appVersionFrom(env: Readonly<Record<string, string | undefined>>): string {
  const ref = env.GITHUB_REF_NAME?.trim();
  // The staging build is started by a `workflow_run` (CI passed), where GITHUB_SHA is the default
  // branch's newest commit, not the one CI verified and the build checked out: deploy.yml hands
  // that one in as APP_COMMIT_SHA (B11, owner 2026-10-21; staging only). Else GITHUB_SHA.
  const sha = (env.APP_COMMIT_SHA?.trim() || env.GITHUB_SHA?.trim())?.slice(0, 7);
  const appEnv = env.NEXT_PUBLIC_APP_ENV?.trim();
  if (env.GITHUB_REF_TYPE === "tag" && ref) return ref;
  if (appEnv && appEnv !== "production" && sha) return `${appEnv} · ${sha}`;
  if (ref && sha) return `${ref} · ${sha}`;
  return sha || "local";
}
