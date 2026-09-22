/**
 * core/db: Supabase clients and generated types.
 *
 * Import the client you need from its own file, because the server and service
 * clients are `server-only` and must never reach a browser bundle:
 *   - `@/core/db/server`  → `createServerSupabase()` (RLS as the signed-in member)
 *   - `@/core/db/browser` → `createBrowserSupabase()` (RLS, Client Components)
 *   - `@/core/db/service` → `createServiceSupabase()` (bypasses RLS; jobs only)
 *
 * This entry point only exposes the generated types and the public env reader.
 * The secret-key reader lives in `env.server.ts` behind `server-only`.
 * Only `data/` layers may import from here (CLAUDE.md engineering rule 3).
 */
export type { Database, Enums, Json, Tables, TablesInsert, TablesUpdate } from "./database.types";
export { publicSupabaseEnv } from "./env";
