import { backgroundGet } from "@/core/http/background-route";
import { readAvailability } from "@/modules/tasks";

/**
 * The task dialog's warning check (4.3): `?member=<id>&member=<id>&day=<YYYY-MM-DD>`, read on a
 * debounce while the dialog is open. A background call (ARCHITECTURE §4.4): a plain request, never
 * a server action that could hold a navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) =>
  readAvailability({ memberIds: query.getAll("member"), days: query.getAll("day") }),
);
