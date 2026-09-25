/**
 * modules/team: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * Pages compose these; nothing else in the module is imported from outside.
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 */
export { offerableJobTitles, type JobTitleOption } from "./domain/job-titles";
export { getOwnMember, listDirectory, listMembers } from "./data/members";
export { memberActions, sortMembers, type TeamMember } from "./domain/members";
export { NAME_MAX_LENGTH, PHONE_MAX_LENGTH } from "./domain/limits";
/** The member's own name and phone, for the edit pattern on /me (2.9). */
export { updateOwnProfile } from "./actions/members";
