import { getCurrentMember } from "@/core/auth/server";
import { toAppError } from "@/core/errors";
import { subscriptionSchema } from "@/core/notifications/push/schemas";
import { rpcPushSubscriptionUpsert } from "@/core/notifications/push/subscriptions";

/**
 * The service worker's way to store a subscription (task 5.2): `pushsubscriptionchange` fires
 * with no page open, where a server action cannot be called, so `public/sw.js` POSTs the new
 * subscription here with the session cookies (same origin). The page's own subscribe goes
 * through `subscribePush` (an action). `/api/*` is public in the proxy, so this authenticates
 * itself: no active member, no row (401). The same RPC and rules as the automatic re-subscribe:
 * a device the member removed from Me's list stays off (409, owner 2026-10-06).
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await getCurrentMember()))
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "VALIDATION" }, { status: 400 });
  try {
    return Response.json({ id: await rpcPushSubscriptionUpsert(parsed.data) });
  } catch (error) {
    if (toAppError(error).code === "INVALID_STATE") {
      return Response.json({ error: "INVALID_STATE" }, { status: 409 });
    }
    throw error;
  }
}
