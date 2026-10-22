import { backgroundGet } from "@/core/http/background-route";

import { readPersonHistory } from "./read";

/**
 * A person's history, read by the person page's History sheet as it opens (`?member=`). A
 * background call (ARCHITECTURE §4.4): the sheet's effect sends it, never the person's layout.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) => readPersonHistory({ memberId: query.get("member") }));
