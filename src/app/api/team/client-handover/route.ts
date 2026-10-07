import { backgroundGet } from "@/core/http/background-route";
import { readClientHandover } from "@/modules/team";

/**
 * The clients an Admin runs and the Admins who may take them, read as the Owner opens a demotion
 * or a deactivation (`?member=<id>`). A background call (ARCHITECTURE §4.4): the dialog's effect
 * sends it, so a plain request, never a server action that could hold a navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) => readClientHandover({ memberId: query.get("member") }));
