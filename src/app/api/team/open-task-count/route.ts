import { backgroundGet } from "@/core/http/background-route";
import { readOpenTaskCount } from "@/modules/team";

/**
 * A freelancer's open tasks, read as the Owner opens "Invite as employee" (`?member=<id>`). A
 * background call (ARCHITECTURE §4.4): the dialog's effect sends it, so a plain request, never a
 * server action that could hold a navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) => readOpenTaskCount({ memberId: query.get("member") }));
