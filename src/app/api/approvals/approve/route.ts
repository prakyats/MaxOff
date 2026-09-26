import { z } from "zod";

import { fail } from "@/core/errors";
import { sameOrigin } from "@/core/http/origin";
import { approveDay } from "@/modules/attendance";
import { approveLeave } from "@/modules/leave";

/**
 * One approval from the Approvals screen's delayed send (WORKFLOWS §1 "Settled in 2.4"). A route
 * handler rather than a server action only so the browser can send it with `keepalive`: the send
 * that fires when the app is hidden, closed or left must outlive the page. The work is the same
 * server action the screen would call (zod → `assertPermission` → transition function), and it
 * answers with its `Result`.
 *
 * `/api/*` is public in the proxy, so this authenticates itself: the action's permission check
 * reads the session cookie, and a request from another origin is refused before anything runs.
 */
const bodySchema = z.object({ kind: z.enum(["day", "leave"]), id: z.uuid() });

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request.headers.get("origin"), request.url)) {
    return Response.json(fail("FORBIDDEN"), { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json(fail("VALIDATION"), { status: 400 });

  const { kind, id } = parsed.data;
  const result =
    kind === "day" ? await approveDay({ dayId: id }) : await approveLeave({ requestId: id });
  return Response.json(result);
}
