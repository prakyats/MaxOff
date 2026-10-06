/**
 * modules/team: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * Pages compose these; nothing else in the module is imported from outside.
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 */
export { offerableJobTitles, type JobTitleOption } from "./domain/job-titles";
export {
  getOwnMember,
  getPerson,
  listCoordinatorHistory,
  listCurrentCoordinators,
  listDirectory,
  listDirectoryOf,
  listMembers,
  listOwnFreelancerIds,
  listOwnFreelancers,
} from "./data/members";
export {
  coordinatorOptions,
  freelancerLine,
  hasAttendance,
  memberActions,
  roleLabel,
  sortMembers,
  STATUS_LABELS,
  type CoordinatorSpell,
  type Engagement,
  type OwnFreelancer,
  type TeamMember,
} from "./domain/members";
export { NAME_MAX_LENGTH, PHONE_MAX_LENGTH } from "./domain/limits";
/** The member's own name and phone, for the edit pattern on /me (2.9). */
export { updateOwnProfile } from "./actions/members";
/** The member's own photo (3.3). */
export { removeOwnAvatar, setOwnAvatar } from "./actions/members";
/** Background reads behind `/api/team/*` (ARCHITECTURE §4.4): plain server functions, not actions. */
export {
  readClientHandover,
  readCoordinatorChoices,
  readFreelancerHandover,
  readOpenTaskCount,
} from "./actions/background";
