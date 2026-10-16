import { ADMIN_GUIDE } from "./content/admin";
import { CREW_GUIDE } from "./content/crew";
import { OWNER_GUIDE } from "./content/owner";
import type { Guide, GuideRole } from "./types";

const GUIDES: Record<GuideRole, Guide> = {
  owner: OWNER_GUIDE,
  admin: ADMIN_GUIDE,
  staff: CREW_GUIDE,
};

/**
 * The reader's own guide, and only theirs (ROADMAP 6b.14: "don't provide all the explanation for
 * everyone"). The page picks it on the server, so another role's topics never reach the browser:
 * a Crew member's payload holds no Admin or Owner topic and nothing about client work
 * (invariant 4).
 */
export function guideFor(role: GuideRole): Guide {
  return GUIDES[role];
}
