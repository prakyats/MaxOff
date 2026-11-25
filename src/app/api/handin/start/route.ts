import { backgroundPost } from "@/core/http/background-route";
import { startHandinFile } from "@/modules/handin";

/**
 * v5.0 hand-in: one file chosen for the open version: the database decides, then the Worker opens its Google session. A background call
 * (ARCHITECTURE §4.4) the upload engine sends on its own; refused from another origin.
 */
export const dynamic = "force-dynamic";

export const POST = backgroundPost((body) => startHandinFile(body));
