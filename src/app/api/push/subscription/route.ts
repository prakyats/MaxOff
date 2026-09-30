import { getCurrentMember } from "@/core/auth/server";
import { subscriptionSchema } from "@/core/notifications/push/schemas";
import { rpcPushSubscriptionUpsert } from "@/core/notifications/push/subscriptions";

/**
 * The service worker's way to store a subscription (task 5.2): `pushsubscriptionchange` fires
 * with no page open, where a server action cannot be called, so `public/sw.js` POSTs the new
 * subscription here with the session cookies (same origin). The page's own subscribe goes
 * through `subscribePush` (an action). `/api/*` is public in the proxy, so this authenticates
 * itself: no active member, no row (401). The same RPC and rules as the action.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await getCurrentMember()))
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "VALIDATION" }, { status: 400 });
  const id = await rpcPushSubscriptionUpsert(parsed.data);
  return Response.json({ id });
}
