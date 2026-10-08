// The Worker entry (task 3.3, ARCHITECTURE §11): OpenNext's handler for every request, plus the
// cron triggers (`wrangler.jsonc` → `triggers.crons`). A cron cannot run inside Postgres when
// the job needs the network (deleting objects in R2), so the schedule lives on the Worker and
// calls the app's own `/api/cron/<job>` route through the self-reference binding, with the
// shared secret the route checks. `wrangler deploy` bundles this file; `.open-next/worker.js`
// is what `pnpm build:worker` produced.
// First: installs Sentry's per-request scopes before any other module runs (ADR-0014).
import { runInRequestScope } from "../src/core/observability/request-scope.ts";
import openNext from "../.open-next/worker.js";
import { canonicalRedirectUrl } from "../src/core/http/canonical-host.ts";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "../.open-next/worker.js";

/** The security headers a redirect the Worker answers itself still carries (ARCHITECTURE §18.3). */
const REDIRECT_HEADERS = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Cache-Control": "no-store",
};

/** Cron expression → the job route it runs (WORKFLOWS §8, `worker` rows). */
const CRON_ROUTES = {
  // 03:00 IST = 21:30 UTC, daily.
  "30 21 * * *": "/api/cron/storage-cleanup",
  // Every minute (5.2): queued push and email deliveries, retries, the 07:00 IST quiet-hours summary.
  "* * * * *": "/api/cron/push-dispatch",
};

const worker = {
  /**
   * Production only (3c.1, kickoff 3c decision 3a): `CANONICAL_HOST` is a `vars` entry of the
   * production environment in `wrangler.jsonc`, so a request on `maxoff.pixoraclips.workers.dev`
   * is sent to the same path on `https://app.maxoff.in` with one 308. Staging and the branch
   * previews have no such var and are served as they are.
   *
   * @param {Request} request
   * @param {Record<string, unknown>} env
   * @param {ExecutionContext} ctx
   */
  fetch(request, env, ctx) {
    const canonical = typeof env.CANONICAL_HOST === "string" ? env.CANONICAL_HOST : undefined;
    const target = canonicalRedirectUrl(request.url, canonical);
    if (target) {
      return new Response(null, {
        status: 308,
        headers: { ...REDIRECT_HEADERS, Location: target },
      });
    }
    // Its own Sentry isolation scope, so a member id set by one request never tags another
    // request's report (`core/observability/request-scope.ts`, ADR-0014).
    return runInRequestScope(() => openNext.fetch(request, env, ctx));
  },

  /**
   * @param {ScheduledController} controller
   * @param {Record<string, unknown>} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(controller, env, ctx) {
    const route = CRON_ROUTES[controller.cron];
    if (!route) {
      console.warn(`[cron] no route for "${controller.cron}"`);
      return;
    }
    const secret = typeof env.CRON_SECRET === "string" ? env.CRON_SECRET : "";
    const self = /** @type {{ fetch: typeof fetch } | undefined} */ (env.WORKER_SELF_REFERENCE);
    if (!self) {
      console.error("[cron] WORKER_SELF_REFERENCE binding is missing");
      return;
    }
    // The host is a placeholder: a service binding routes by binding, not by name.
    // Workers Logs records the request itself; only a refusal or a failure is worth a line.
    const run = self
      .fetch(`https://maxoff.internal${route}`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "x-cron": controller.cron },
      })
      .then(async (response) => {
        if (!response.ok) {
          console.warn(
            `[cron] ${route} → ${response.status} ${(await response.text()).slice(0, 500)}`,
          );
        }
      })
      .catch((error) => {
        console.error(
          `[cron] ${route} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    ctx.waitUntil(run);
  },
};

export default worker;
