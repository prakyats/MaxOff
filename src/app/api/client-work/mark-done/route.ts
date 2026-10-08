import { z } from "zod";

import { fail } from "@/core/errors";
import { sameOrigin } from "@/core/http/origin";
import { markItemDone } from "@/modules/client-work";

/**
 * One "Mark done" from Today's Client work (7.3; kickoff 7 decision 19): the delayed send behind its
 * 6-second Undo. A route handler rather than a server action only so the browser can send it with
 * `keepalive`: the send that fires when the app is hidden, closed or left must outlive the page
 * (as Approvals', `app/api/approvals/approve`). The work is the server action itself (zod →
 * `assertPermission("items.tick")` → `item_mark_done`), answering with its `Result`.
 *
 * `/api/*` is public in the proxy, so this authenticates itself: the action's permission check
 * reads the session cookie, and a request from another origin is refused before anything runs.
 */
const bodySchema = z.object({ id: z.uuid() });

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request.headers.get("origin"), request.url)) {
    return Response.json(fail("FORBIDDEN"), { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json(fail("VALIDATION"), { status: 400 });
  return Response.json(await markItemDone({ itemId: parsed.data.id }));
}
