import { backgroundGet } from "@/core/http/background-route";
import { readUnreadCount } from "@/core/notifications/background";

/**
 * The bell's count (`{ count, countedAt }`), asked by the live bell on its first join and to
 * confirm the device's own reads (task 5.1, owner decision 2026-10-01). A background call
 * (ARCHITECTURE §4.4): a Realtime callback sends it, so a plain request, never a server action
 * that could hold a navigation (CI run 37118131079).
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet(() => readUnreadCount());
