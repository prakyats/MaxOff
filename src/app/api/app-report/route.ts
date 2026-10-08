import { backgroundPost } from "@/core/http/background-route";
import { reportAppOpen } from "@/core/notifications/background";

/**
 * The app's report about itself, once per open (task 5.4): its platform and whether it runs
 * installed. A background call (ARCHITECTURE §4.4): sent by a lazily loaded module after the first
 * load, so a plain request, never a server action that could hold a navigation.
 */
export const POST = backgroundPost(reportAppOpen);
