/**
 * The build's deployment id (P2, ADR-0014): Next's `deploymentId`, which every router request
 * then carries as `x-deployment-id` and every answer as `x-nextjs-deployment-id`. The service
 * worker keeps a prefetched skeleton for the deployment that asked for it (`public/sw.js`), so a
 * page is never answered with another build's, and Next compares it instead of its build id to
 * load a new deployment whole. One per build: the commit, the workflow run and its attempt on
 * GitHub Actions (staging, previews, production and CI), so two builds never share one; "local"
 * elsewhere (a developer's own production build, where a rebuild is a reload). Only the
 * characters a header and a query value carry as they are.
 */
export function deploymentIdFrom(env: Readonly<Record<string, string | undefined>>): string {
  const sha = env.GITHUB_SHA?.trim().slice(0, 12);
  const run = env.GITHUB_RUN_ID?.trim();
  const attempt = env.GITHUB_RUN_ATTEMPT?.trim() || "1";
  const parts = sha && run ? [sha, run, attempt] : sha ? [sha] : ["local"];
  return parts.join("-").replace(/[^A-Za-z0-9_-]/g, "");
}
