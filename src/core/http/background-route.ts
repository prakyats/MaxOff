import "server-only";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, type ErrorCode, fail, ok, type Result } from "@/core/errors";

import { sameOrigin } from "./origin";

/**
 * The server half of a **background call** (ARCHITECTURE §4.4): a route handler the app reaches
 * with a plain `fetch` (`core/http/background.ts`), never a server action. A server action sent
 * while a navigation is in flight is queued by Next behind that navigation, and the new page is
 * not committed until the action answers (CI run 37118131079): anything the app sends on its own
 * (an effect, a timer, a Realtime callback, a lazy import) goes through one of these instead.
 *
 * Each handler does what the action did: `/api/*` is public in the proxy, so it refuses a caller
 * who is not a signed-in active member (401) before anything runs, a POST from another origin
 * (403, the CSRF check), and then hands the input to the module's own function, which parses it
 * with zod and checks the permission exactly as the action did. The answer is that `Result`,
 * as JSON, with a matching status; nothing is cached.
 */

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  INVALID_STATE: 409,
  REASON_REQUIRED: 400,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** The HTTP status a `Result` is answered with. */
export function statusOf(result: Result<unknown>): number {
  return result.ok ? 200 : STATUS[result.error.code];
}

function answer(result: Result<unknown>): Response {
  return Response.json(result, {
    status: statusOf(result),
    headers: { "cache-control": "no-store" },
  });
}

async function asMember<T>(run: () => Promise<T>): Promise<Response> {
  const result = await action(async (): Promise<Result<T>> => {
    if (!(await getCurrentMember())) throw new AppError("UNAUTHENTICATED");
    return ok(await run());
  })();
  return answer(result);
}

/**
 * A background read: `GET` with its input in the query. `read` builds the module function's
 * input from the query (repeated keys with `getAll`) and returns its data; zod runs inside it.
 */
export function backgroundGet<T>(
  read: (query: URLSearchParams) => Promise<T>,
): (request: Request) => Promise<Response> {
  return (request) => asMember(() => read(new URL(request.url).searchParams));
}

/**
 * A background write: `POST` with a JSON body, refused from another origin. `write` gets the
 * parsed body as `unknown` (an unreadable body is `null`, which its zod schema refuses).
 */
export function backgroundPost<T>(
  write: (body: unknown) => Promise<T>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (!sameOrigin(request.headers.get("origin"), request.url)) {
      return answer(fail("FORBIDDEN"));
    }
    const body: unknown = await request.json().catch(() => null);
    return asMember(() => write(body));
  };
}
