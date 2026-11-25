import { backgroundPost } from "@/core/http/background-route";
import { reportHandinProgress } from "@/modules/handin";

/**
 * v5.0 hand-in: the bytes a file has sent so far (at most one write per file every 5 seconds). A background call
 * (ARCHITECTURE §4.4) the upload engine sends on its own; refused from another origin.
 */
export const dynamic = "force-dynamic";

export const POST = backgroundPost((body) => reportHandinProgress(body));
