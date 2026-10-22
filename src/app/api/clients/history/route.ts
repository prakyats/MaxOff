import { backgroundGet } from "@/core/http/background-route";

import { readClientHistory } from "./read";

/**
 * A client's history, read by the client page's History sheet as it opens (`?client=`). A
 * background call (ARCHITECTURE §4.4): the sheet's effect sends it, never a server action, and
 * never the client's layout (its prefetch reads the layout's own reads alone).
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) => readClientHistory({ clientId: query.get("client") }));
