import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { createServiceSupabase } from "@/core/db/service";
import { AppError } from "@/core/errors";

import type { MemberRole, MemberStatus, TeamMember } from "../domain/members";

/**
 * The team repository: every database and Auth-admin call of the module (CLAUDE.md rule 3).
 * Reads go through RLS as the signed-in member; the service client is used only for the
 * Auth admin API, never to read or write a table.
 */

const MEMBER_COLUMNS =
  "id, full_name, email, phone, role, status, job_title_id, invited_at, joined_at, created_at, job_title:list_items(name)";
const DIRECTORY_COLUMNS =
  "id, full_name, phone, role, status, job_title_id, created_at, job_title:list_items(name)";

type MemberRow = {
  id: string;
  full_name: string;
  email?: string;
  phone: string | null;
  role: MemberRole;
  status: MemberStatus;
  job_title_id: string | null;
  invited_at?: string;
  joined_at?: string | null;
  created_at: string;
  job_title: { name: string } | null;
};

function toTeamMember(row: MemberRow): TeamMember {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email ?? null,
    phone: row.phone,
    role: row.role,
    status: row.status,
    jobTitleId: row.job_title_id,
    jobTitle: row.job_title?.name ?? null,
    invitedAt: row.invited_at ?? null,
    joinedAt: row.joined_at ?? null,
    createdAt: row.created_at,
  };
}

/** Every member with email and dates: the `members` table, which RLS opens to `team.manage`. */
export async function listMembers(): Promise<TeamMember[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("members").select(MEMBER_COLUMNS);
  if (error) throw error;
  return data.map(toTeamMember);
}

/** Everyone without email: `member_directory`, for `team.view` (PERMISSIONS §2). */
export async function listDirectory(): Promise<TeamMember[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("member_directory").select(DIRECTORY_COLUMNS);
  if (error) throw error;
  return data.map((row) => {
    // A security-definer view's columns are typed nullable; the base table's are not.
    if (!row.id || !row.full_name || !row.role || !row.status || !row.created_at) {
      throw new AppError("INTERNAL", undefined, {
        cause: new Error("member_directory row incomplete"),
      });
    }
    return toTeamMember({
      id: row.id,
      full_name: row.full_name,
      phone: row.phone,
      role: row.role,
      status: row.status,
      job_title_id: row.job_title_id,
      created_at: row.created_at,
      job_title: row.job_title,
    });
  });
}

/** The caller's own row (RLS: always visible), for the profile form. */
export async function getOwnMember(id: string): Promise<TeamMember | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("members")
    .select(MEMBER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toTeamMember(data) : null;
}

/** Plain edit by `team.manage` (audited by trigger). Role stays as it is when not given. */
export async function updateMember(
  id: string,
  patch: { full_name: string; role?: MemberRole | undefined; job_title_id: string | null },
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("members")
    .update(
      {
        full_name: patch.full_name,
        job_title_id: patch.job_title_id,
        ...(patch.role ? { role: patch.role } : {}),
      },
      { count: "exact" },
    )
    .eq("id", id);
  if (error) throw error;
  if (count === 0) throw new AppError("NOT_FOUND", "This person is not on the team.");
}

/** A member's own name and phone (PERMISSIONS §3; the guard refuses anything else). */
export async function updateOwnProfile(
  id: string,
  patch: { full_name: string; phone: string | null },
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("members").update(patch).eq("id", id);
  if (error) throw error;
}

// Transition functions (ADR-0006) ----------------------------------------------------------------

export async function rpcInvite(args: {
  user_id: string;
  email: string;
  full_name: string;
  role: MemberRole;
  job_title_id: string | null;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("member_invite", {
    user_id: args.user_id,
    email: args.email,
    full_name: args.full_name,
    role: args.role,
    ...(args.job_title_id ? { job_title_id: args.job_title_id } : {}),
  });
  if (error) throw error;
  return data;
}

export async function rpcRefreshInvite(memberId: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("member_invite_refresh", { member_id: memberId });
  if (error) throw error;
  return data;
}

export async function rpcDeactivate(memberId: string, reason: string | null): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("member_deactivate", {
    member_id: memberId,
    ...(reason ? { reason } : {}),
  });
  if (error) throw error;
  return data;
}

export async function rpcReactivate(memberId: string): Promise<MemberStatus> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("member_reactivate", { member_id: memberId });
  if (error) throw error;
  return data === "active" ? "active" : "invited";
}

/** Whether an email already belongs to a member, whatever their status (team.manage reads all). */
export async function findMemberByEmail(email: string): Promise<TeamMember | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("members")
    .select(MEMBER_COLUMNS)
    .ilike("email", email)
    .maybeSingle();
  if (error) throw error;
  return data ? toTeamMember(data) : null;
}

// Supabase Auth admin API (service key; creates sign-ins, never touches app tables) ---------------

export type InviteLinkType = "invite" | "recovery";

export type InviteToken = { userId: string; tokenHash: string; type: InviteLinkType };

/**
 * A one-time token for the person's invite link (`generateLink` sends no email: the app does).
 * GoTrue issues an `invite` token only while the auth user is unconfirmed; opening a link
 * confirms them even when the password was never set, so once `email_exists` comes back a
 * `recovery` token is issued instead. Both land on `/set-password`, where the invited member
 * is accepted (WORKFLOWS §1a). Creates the auth user when there is none.
 */
export async function issueInviteToken(email: string): Promise<InviteToken> {
  const service = createServiceSupabase();
  const invite = await service.auth.admin.generateLink({ type: "invite", email });
  if (!invite.error) return tokenFrom(invite.data, "invite");
  if (invite.error.code !== "email_exists") throw invite.error;

  const recovery = await service.auth.admin.generateLink({ type: "recovery", email });
  if (recovery.error) throw recovery.error;
  return tokenFrom(recovery.data, "recovery");
}

function tokenFrom(
  data: { user: { id: string } | null; properties: { hashed_token: string } | null },
  type: InviteLinkType,
): InviteToken {
  const tokenHash = data.properties?.hashed_token;
  if (!data.user?.id || !tokenHash) {
    throw new AppError("INTERNAL", undefined, {
      cause: new Error("generateLink returned no token"),
    });
  }
  return { userId: data.user.id, tokenHash, type };
}

/** Rolls back the auth user when the member row could not be written. Best effort. */
export async function deleteAuthUser(userId: string): Promise<void> {
  const service = createServiceSupabase();
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error)
    console.error(
      `[team] could not remove the auth user after a failed invite (${error.code ?? "no code"})`,
    );
}
