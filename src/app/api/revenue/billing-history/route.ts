import { backgroundGet } from "@/core/http/background-route";
import { readBillingHistoryPage } from "@/modules/revenue";

/**
 * A page of a project's Billing history (v2.5, Q7), read by the Owner's Billing section as the
 * history opens and on "Show older" (`?project=&limit=&oneTime=0|1`). A background call
 * (ARCHITECTURE §4.4): the section's effect sends it, never a server action. Owner only: the
 * module checks `finance.view`, and the function refuses anyone else.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) =>
  readBillingHistoryPage({
    projectId: query.get("project"),
    limit: query.get("limit"),
    oneTime: query.get("oneTime"),
  }),
);
