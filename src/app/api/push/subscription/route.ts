import { backgroundPost } from "@/core/http/background-route";
import { storeOwnSubscription } from "@/core/notifications/background";

/**
 * This device's push subscription, stored again (task 5.2): by `PushSync`'s automatic
 * re-subscribe on a signed-in load, and by the service worker on `pushsubscriptionchange` (no
 * page open, where a server action cannot be called). A background call (ARCHITECTURE §4.4),
 * never a server action that could hold a navigation. `/api/*` is public in the proxy, so the
 * handler refuses another origin (403) and anyone who is not an active member (401); a device
 * the member removed from Me's list stays off (409 INVALID_STATE, owner 2026-10-06). The
 * member's own "Turn on" tap is the server action `turnOnPush`.
 */
export const POST = backgroundPost(storeOwnSubscription);
