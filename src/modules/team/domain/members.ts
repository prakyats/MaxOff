import type { Enums } from "@/core/db";

export type MemberRole = Enums<"member_role">;
export type MemberStatus = Enums<"member_status">;
/** ADR-0013 (4A): `freelance` is a person with no login, looked after by a coordinator. */
export type Engagement = Enums<"engagement">;

/** One row of the Team screen. `email` is null for everyone but `team.manage` (PERMISSIONS §2). */
export type TeamMember = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: MemberRole;
  status: MemberStatus;
  /** Data, not a role (ADR-0013): a freelancer carries `role = staff` and has no login. */
  engagement: Engagement;
  jobTitleId: string | null;
  jobTitle: string | null;
  /** The member's photo (3.3), an original in `files`; lists show its preview. */
  avatarFileId: string | null;
  invitedAt: string | null;
  joinedAt: string | null;
  createdAt: string;
};

export const STATUS_LABELS: Record<MemberStatus, string> = {
  invited: "Invited",
  active: "Active",
  deactivated: "Deactivated",
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};

export type MemberActions = {
  /** Name, role and job title on the person's page; the Owner edits their own row on /me (3.4). */
  edit: boolean;
  /** Role is locked on the Owner row (invariant 1); name and job title still change. */
  editRole: boolean;
  /** Moving the sign-in itself (1.4): never on a closed one. */
  changeEmail: boolean;
  copyInviteLink: boolean;
  revokeInvite: boolean;
  deactivate: boolean;
  reactivate: boolean;
};

const NONE: MemberActions = {
  edit: false,
  editRole: false,
  changeEmail: false,
  copyInviteLink: false,
  revokeInvite: false,
  deactivate: false,
  reactivate: false,
};

/**
 * Which controls a row offers (WORKFLOWS §1a). The UI only hides; `member_deactivate()` and
 * friends refuse the same cases (self, the Owner, wrong state) and RLS refuses the rest.
 */
export function memberActions(
  viewer: { id: string; canManage: boolean },
  member: Pick<TeamMember, "id" | "role" | "status">,
): MemberActions {
  if (!viewer.canManage) return NONE;
  const self = member.id === viewer.id;
  const owner = member.role === "owner";
  return {
    edit: member.status !== "deactivated" && !self,
    editRole: member.status !== "deactivated" && !owner,
    // The Owner's own row included: they are the only one who can do it (PERMISSIONS §3).
    changeEmail: member.status !== "deactivated",
    copyInviteLink: member.status === "invited",
    revokeInvite: member.status === "invited" && !self,
    deactivate: member.status === "active" && !self && !owner,
    reactivate: member.status === "deactivated",
  };
}

/** The `EditableRecord` key a ⋯ menu or a list's Edit reaches a person's profile by (3.4). */
export function memberEditKey(memberId: string): string {
  return `member:${memberId}`;
}

/**
 * Whether a row opens the person's page (3.4, kickoff 3): every member does, for whoever holds
 * `team.view`, except the Owner's own row, which lives on /me.
 */
export function opensPersonPage(
  viewer: { id: string },
  member: Pick<TeamMember, "id" | "role">,
): boolean {
  return !(member.id === viewer.id && member.role === "owner");
}

/** Whether the person has an attendance history for the Owner (2.4): joined, and not the Owner. */
export function hasAttendance(member: Pick<TeamMember, "role" | "joinedAt">): boolean {
  return member.role !== "owner" && member.joinedAt !== null;
}

/** Sort: the Owner first, then active people, then invited, then deactivated; by name within. */
export function sortMembers(members: readonly TeamMember[]): TeamMember[] {
  const statusRank: Record<MemberStatus, number> = { active: 0, invited: 1, deactivated: 2 };
  return [...members].sort((a, b) => {
    if ((a.role === "owner") !== (b.role === "owner")) return a.role === "owner" ? -1 : 1;
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }
    return a.fullName.localeCompare(b.fullName);
  });
}
