/**
 * The production Worker answers on two hosts: `app.maxoff.in` (its custom domain) and
 * `maxoff.pixoraclips.workers.dev` (the address every Worker has). Only the first is the app
 * (kickoff 3c decision 3a): a request on the `workers.dev` host is sent to the same path on the
 * canonical host with one permanent redirect. Keyed on `CANONICAL_HOST`, a `vars` entry of the
 * production environment in `wrangler.jsonc` alone, so staging and the branch previews (which
 * live on `workers.dev`) are never redirected. Only a `workers.dev` host is redirected: the
 * cron's self-call arrives on a placeholder host through the service binding and must pass.
 * Pure, so `worker/index.js` and the unit test share it.
 */
export const WORKERS_DEV_SUFFIX = ".workers.dev";

export function canonicalRedirectUrl(
  requestUrl: string,
  canonicalHost: string | undefined,
): string | null {
  const host = canonicalHost?.trim().toLowerCase();
  if (!host) return null;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  const requestHost = url.host.toLowerCase();
  if (requestHost === host || !requestHost.endsWith(WORKERS_DEV_SUFFIX)) return null;
  return `https://${host}${url.pathname}${url.search}`;
}
