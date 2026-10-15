import { backgroundGet } from "@/core/http/background-route";
import { readDeliverableTemplateOptions } from "@/modules/client-work";

/**
 * The active deliverable templates, read by "+ Add deliverable" as it opens (6b Release 2). A
 * background call (ARCHITECTURE §4.4): the dialog's effect sends it, never a server action.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet(() => readDeliverableTemplateOptions());
