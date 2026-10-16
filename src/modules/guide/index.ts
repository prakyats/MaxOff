/**
 * The in-app "How MaxOff works" guide (ROADMAP 6b.14): each role's topics as data, chosen on the
 * server for the reader's role. No tables, no actions: content only.
 */
export { guideFor } from "./domain/guide";
export { normalise, searchGuide, stepText, topicCount } from "./domain/search";
export { GUIDE_SHOTS } from "./domain/shots.generated";
export type {
  Guide,
  GuideBlock,
  GuideLink,
  GuideRole,
  GuideSection,
  GuideStep,
  GuideTopic,
} from "./domain/types";
