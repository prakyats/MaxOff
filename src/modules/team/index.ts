/**
 * modules/team: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * Pages compose these; nothing else in the module is imported from outside.
 */
export { InviteMemberDialog } from "./components/invite-member-dialog";
export { ProfileForm } from "./components/profile-form";
export { TeamTable } from "./components/team-table";
export { getOwnMember, listDirectory, listMembers } from "./data/members";
export { memberActions, sortMembers, type TeamMember } from "./domain/members";
