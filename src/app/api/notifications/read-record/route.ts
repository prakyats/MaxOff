import { backgroundPost } from "@/core/http/background-route";
import { markRecordRead } from "@/core/notifications/background";

/**
 * Opening a record reads the member's notifications about it (kickoff 5 decision 4), sent by the
 * record page in the background. A background call (ARCHITECTURE §4.4): a plain request, never a
 * server action that could hold a navigation.
 */
export const POST = backgroundPost(markRecordRead);
