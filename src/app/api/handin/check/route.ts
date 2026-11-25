import { backgroundPost } from "@/core/http/background-route";
import { checkHandinInDrive } from "@/modules/handin";

/**
 * v5.0 hand-in: "Removed in Drive", asked once the reviewer's card is on screen (never on the
 * page's first render; each file at most every 10 minutes). A background call (ARCHITECTURE §4.4).
 */
export const dynamic = "force-dynamic";

export const POST = backgroundPost((body) => checkHandinInDrive(body));
