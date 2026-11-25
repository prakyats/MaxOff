import { backgroundPost } from "@/core/http/background-route";
import { failHandinFile } from "@/modules/handin";

/**
 * v5.0 hand-in: the browser gave up on a file (damaged, gave up, unreadable). A background call
 * (ARCHITECTURE §4.4) the upload engine sends on its own; refused from another origin.
 */
export const dynamic = "force-dynamic";

export const POST = backgroundPost((body) => failHandinFile(body));
