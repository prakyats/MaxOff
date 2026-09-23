import type { Enums } from "@/core/db";

export type MemberRole = Enums<"member_role">;
export type MemberStatus = Enums<"member_status">;

/** One row of the Team screen. `email` is null for everyone but `team.manage` (PERMISSIONS §2). */
export type TeamMember = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: MemberRole;
  status: MemberStatus;
  jobTitleId: string | null;
  jobTitle: string | null;
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
  edit: boolean;
  /** Role is locked on the Owner row (invariant 1); name and job title still change. */
  editRole: boolean;
  copyInviteLink: boolean;
  revokeInvite: boolean;
  deactivate: boolean;
  reactivate: boolean;
};

const NONE: MemberActions = {
  edit: false,
  editRole: false,
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
    edit: member.status !== "deactivated",
    editRole: member.status !== "deactivated" && !owner,
    copyInviteLink: member.status === "invited",
    revokeInvite: member.status === "invited" && !self,
    deactivate: member.status === "active" && !self && !owner,
    reactivate: member.status === "deactivated",
  };
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
