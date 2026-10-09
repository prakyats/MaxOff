import { backgroundGet } from "@/core/http/background-route";
import { readProjectActivity } from "@/modules/client-work";

/**
 * A page of a project's activity, or one item's, read by the project page's Activity panel as it
 * opens and on "Show older" (`?project=&kind=&item=&beforeAt=&beforeId=`). A background call
 * (ARCHITECTURE §4.4): the panel's effect sends it, never a server action.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) =>
  readProjectActivity({
    projectId: query.get("project"),
    kind: query.get("kind") ?? undefined,
    itemId: query.get("item"),
    beforeAt: query.get("beforeAt"),
    beforeId: query.get("beforeId"),
  }),
);
