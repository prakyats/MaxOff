import { backgroundGet } from "@/core/http/background-route";
import { readAvailability } from "@/modules/tasks";

/**
 * The task dialog's warning check (4.3): `?everyone=1&day=<YYYY-MM-DD>` (v6.0: everyone the
 * caller may see, for "Who's on it?") or `?member=<id>&member=<id>&day=…`, read on a debounce
 * while the dialog is open. A background call (ARCHITECTURE §4.4): a plain request, never
 * a server action that could hold a navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) =>
  readAvailability(
    query.get("everyone") === "1"
      ? { everyone: true, days: query.getAll("day") }
      : { memberIds: query.getAll("member"), days: query.getAll("day") },
  ),
);
