import { backgroundGet } from "@/core/http/background-route";
import { readFreelancerHandover } from "@/modules/team";

/**
 * The freelancers a person coordinates and who may take them, read as the Owner opens a
 * deactivation (`?member=<id>`, ADR-0013 §2). A background call (ARCHITECTURE §4.4): the dialog's
 * effect sends it, so a plain request, never a server action that could hold a navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet((query) =>
  readFreelancerHandover({ memberId: query.get("member") }),
);
