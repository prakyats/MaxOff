/**
 * Where the e2e server's Supabase proxy listens (`e2e/hold-proxy.ts`, 4C review M1). The e2e
 * build and server talk to Supabase through it (`playwright.config.ts` points
 * `NEXT_PUBLIC_SUPABASE_URL` here); the Playwright process and its helpers still talk to Supabase
 * directly. `127.0.0.1`, like the local stack's own URL, so the session cookie keeps its name
 * (`sb-127-auth-token`: `@supabase/ssr` names it after the host's first label). Port 54331: the
 * local stack uses 54320–54329.
 */
export const HOLD_PROXY_PORT = 54331;
export const HOLD_PROXY_URL = `http://127.0.0.1:${HOLD_PROXY_PORT}`;
