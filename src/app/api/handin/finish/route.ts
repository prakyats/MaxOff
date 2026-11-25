import { backgroundPost } from "@/core/http/background-route";
import { finishHandinFile } from "@/modules/handin";

/**
 * v5.0 hand-in: Google said a file is complete; the Worker asks Google itself before anything is recorded (v4.5 F1). A background call
 * (ARCHITECTURE §4.4) the upload engine sends on its own; refused from another origin.
 */
export const dynamic = "force-dynamic";

export const POST = backgroundPost((body) => finishHandinFile(body));
