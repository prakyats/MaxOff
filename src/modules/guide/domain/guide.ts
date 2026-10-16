import { ADMIN_GUIDE } from "./content/admin";
import { CREW_GUIDE } from "./content/crew";
import { OWNER_GUIDE } from "./content/owner";
import { GUIDE_SHOTS } from "./shots.generated";
import type { Guide, GuideRole, GuideShots } from "./types";

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

/**
 * The screenshots a guide's steps show, and no others: the page hands the reader only these, so
 * no other role's screenshots (an Owner's or an Admin's client work) reach a Crew member's
 * browser (invariant 4).
 */
export function guideShotsFor(guide: Guide): GuideShots {
  const shots: Record<string, GuideShots[string]> = {};
  for (const section of guide.sections) {
    for (const topic of section.topics) {
      for (const block of topic.blocks) {
        if (block.kind !== "steps") continue;
        for (const step of block.steps) {
          if (typeof step === "string" || !step.shot) continue;
          const shot = GUIDE_SHOTS[step.shot];
          if (shot) shots[step.shot] = shot;
        }
      }
    }
  }
  return shots;
}
