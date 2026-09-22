import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext → Cloudflare Workers (ADR-0003). No incremental cache: every page is server-rendered
 * per request and nothing uses ISR. When R2 arrives (task 3.3) an R2 incremental cache can be
 * added here if a cached route ever exists.
 */
export default defineCloudflareConfig({});
