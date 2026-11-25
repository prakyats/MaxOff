import { backgroundGet } from "@/core/http/background-route";
import { readTodayRevenue } from "@/modules/revenue";

/**
 * This IST month's revenue totals for the Owner's Today line (v2.5 review: "Today's figures load
 * on tap"), read only when the Owner taps the line, never with the page. A background read
 * (ARCHITECTURE §4.4; `no-store`): 401 signed out; the module checks `finance.view` (403 for an
 * Admin or Crew), and the function refuses anyone else too.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet(() => readTodayRevenue());
