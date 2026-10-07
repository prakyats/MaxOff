import { backgroundGet } from "@/core/http/background-route";
import { readCoordinatorChoices } from "@/modules/team";

/**
 * A freelancer's coordinator and who may take over, read as the Owner opens "Change coordinator"
 * or a freelancer's reactivation (`?member=<id>`, ADR-0013). A background call (ARCHITECTURE
 * §4.4): the dialog's effect sends it, so a plain request, never a server action that could hold a
 * navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) =>
  readCoordinatorChoices({ memberId: query.get("member") }),
);
