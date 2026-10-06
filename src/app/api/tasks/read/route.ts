import { backgroundPost } from "@/core/http/background-route";
import { markTaskRead } from "@/modules/tasks";

/**
 * Chat in front of the viewer marks its comments read (Kickoff 4 decision 28), sent by the task
 * page in the background. A background call (ARCHITECTURE §4.4): a plain request, never a server
 * action that could hold a navigation.
 */
export const POST = backgroundPost(markTaskRead);
