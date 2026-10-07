/**
 * The version Me's "Help & troubleshooting" shows (5B decision 4): the release tag a production
 * build was made from (`v1.3.0`), else the branch and commit of a staging or preview build
 * (`main · 1a2b3c4d`), else "local". Read from the build's environment (GitHub Actions sets
 * `GITHUB_REF_TYPE`, `GITHUB_REF_NAME` and `GITHUB_SHA` on every step) by `next.config.ts`, which
 * inlines it as `NEXT_PUBLIC_APP_VERSION`: nothing to configure, no secret.
 */
export function appVersionFrom(env: Readonly<Record<string, string | undefined>>): string {
  const ref = env.GITHUB_REF_NAME?.trim();
  const sha = env.GITHUB_SHA?.trim().slice(0, 8);
  if (env.GITHUB_REF_TYPE === "tag" && ref) return ref;
  if (ref && sha) return `${ref} · ${sha}`;
  return sha || "local";
}
