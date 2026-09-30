import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { createServiceSupabase } from "@/core/db/service";
import { AppError } from "@/core/errors";
import { displayName } from "@/core/lib/display-name";

import type {
  CoordinatorSpell,
  Engagement,
  MemberRole,
  MemberStatus,
  OwnFreelancer,
  TeamMember,
} from "../domain/members";

/**
 * The team repository: every database and Auth-admin call of the module (CLAUDE.md rule 3).
 * Reads go through RLS as the signed-in member; the service client is used only for the
 * Auth admin API, never to read or write a table.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEMBER_COLUMNS =
  "id, full_name, email, phone, role, status, engagement, job_title_id, avatar_file_id, invited_at, joined_at, created_at, job_title:list_items(name)";
const DIRECTORY_COLUMNS =
  "id, full_name, phone, role, status, engagement, job_title_id, avatar_file_id, created_at, job_title:list_items(name)";

type MemberRow = {
  id: string;
  full_name: string;
  /** Null for a freelancer (no login, 4A) and for everyone but `team.manage` (PERMISSIONS §2). */
  email?: string | null;
  phone: string | null;
  role: MemberRole;
  status: MemberStatus;
  engagement: Engagement;
  job_title_id: string | null;
  avatar_file_id: string | null;
  invited_at?: string;
  joined_at?: string | null;
  created_at: string;
  job_title: { name: string } | null;
};

function toTeamMember(row: MemberRow): TeamMember {
  return {
    id: row.id,
    fullName: displayName(row.full_name),
    email: row.email ?? null,
    phone: row.phone,
    role: row.role,
    status: row.status,
    engagement: row.engagement,
    jobTitleId: row.job_title_id,
    jobTitle: row.job_title?.name ?? null,
    avatarFileId: row.avatar_file_id,
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
  return data.map(toDirectoryMember);
}

/**
 * The directory rows of these people only (4B): what a Staff member's task page names. For
 * someone without `team.view`, `member_directory` holds the people on or acting on their visible
 * tasks (Kickoff 4 decision 21), computed once per read by `app.directory_visible_ids()` since 4C
 * (it walked the tasks per member row before: 2 s for 82 members, 4A later item (a)).
 */
export async function listDirectoryOf(ids: readonly string[]): Promise<TeamMember[]> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id));
  if (wanted.length === 0) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("member_directory")
    .select(DIRECTORY_COLUMNS)
    .in("id", wanted);
  if (error) throw error;
  return data.map(toDirectoryMember);
}

type DirectoryRow = {
  id: string | null;
  full_name: string | null;
  phone: string | null;
  role: MemberRole | null;
  status: MemberStatus | null;
  engagement: Engagement | null;
  job_title_id: string | null;
  avatar_file_id: string | null;
  created_at: string | null;
  job_title: { name: string } | null;
};

function toDirectoryMember(row: DirectoryRow): TeamMember {
  // A security-definer view's columns are typed nullable; the base table's are not.
  if (!row.id || !row.full_name || !row.role || !row.status || !row.engagement || !row.created_at) {
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
    engagement: row.engagement,
    job_title_id: row.job_title_id,
    avatar_file_id: row.avatar_file_id,
    created_at: row.created_at,
    job_title: row.job_title,
  });
}

/**
 * Who looks after each freelancer now (ADR-0013): freelancer id → current coordinator id, from
 * `freelancer_coordinators` (4C, no reason): every freelancer for `team.view` (the Owner and
 * Admins), and for anyone else the freelancers and coordinators they may both name (Kickoff 4
 * decision 21: a freelancer on their task). The task dialog and page mark a freelancer with their
 * coordinator's name ("Freelancer · with Ravi").
 */
export async function listCurrentCoordinators(): Promise<Record<string, string>> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("freelancer_coordinators")
    .select("member_id, coordinator_id");
  if (error) throw error;
  return Object.fromEntries(
    data.flatMap((row) =>
      row.member_id && row.coordinator_id ? [[row.member_id, row.coordinator_id] as const] : [],
    ),
  );
}

/**
 * The freelancers the signed-in member looks after now: their own current rows of
 * `coordinated_freelancers` (4A review S4, no reason). What lets a task page offer "Noted for
 * Asha" to her coordinator (4.4); empty for anyone who coordinates nobody.
 */
export async function listOwnFreelancerIds(): Promise<string[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("coordinated_freelancers")
    .select("member_id")
    .is("to_at", null);
  if (error) throw error;
  return data.flatMap((row) => (row.member_id ? [row.member_id] : []));
}

/**
 * A freelancer's coordinators, now and before, newest first (`member_coordinators`, 4A): RLS
 * gives them to `team.view` (the Owner and Admins) with the reason (Kickoff 4 decision 20), and
 * nothing to anyone else.
 */
export async function listCoordinatorHistory(memberId: string): Promise<CoordinatorSpell[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("member_coordinators")
    .select("id, coordinator_id, from_at, to_at, set_by, reason")
    .eq("member_id", memberId)
    .order("from_at", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    coordinatorId: row.coordinator_id,
    fromAt: row.from_at,
    toAt: row.to_at,
    setBy: row.set_by,
    reason: row.reason,
  }));
}

/**
 * The freelancers the signed-in member looks after, now and before, newest first (their own
 * `coordinated_freelancers` rows, 4A review S4: never the reason): "Your freelancers" on /me.
 */
export async function listOwnFreelancers(): Promise<OwnFreelancer[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("coordinated_freelancers")
    .select("member_id, from_at, to_at")
    .order("from_at", { ascending: false });
  if (error) throw error;
  return data.flatMap((row) =>
    row.member_id && row.from_at
      ? [{ memberId: row.member_id, fromAt: row.from_at, toAt: row.to_at }]
      : [],
  );
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

/**
 * One person for their page (3.4): the `members` row (email, dates) for `team.manage`, the
 * directory row for everyone else with `team.view` (PERMISSIONS §2: no email).
 */
export async function getPerson(id: string, full: boolean): Promise<TeamMember | null> {
  if (full) return getOwnMember(id);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("member_directory")
    .select(DIRECTORY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (
    !data.id ||
    !data.full_name ||
    !data.role ||
    !data.status ||
    !data.engagement ||
    !data.created_at
  ) {
    throw new AppError("INTERNAL", undefined, {
      cause: new Error("member_directory row incomplete"),
    });
  }
  return toTeamMember({
    id: data.id,
    full_name: data.full_name,
    phone: data.phone,
    role: data.role,
    status: data.status,
    engagement: data.engagement,
    job_title_id: data.job_title_id,
    avatar_file_id: data.avatar_file_id,
    created_at: data.created_at,
    job_title: data.job_title,
  });
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

/** "Add person → Freelancer" (ADR-0013): no email, no sign-in, a coordinator. */
export async function rpcAddFreelancer(args: {
  fullName: string;
  jobTitleId: string | null;
  phone: string | null;
  coordinatorId: string;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("member_add_freelancer", {
    full_name: args.fullName,
    coordinator_id: args.coordinatorId,
    ...(args.jobTitleId ? { job_title_id: args.jobTitleId } : {}),
    ...(args.phone ? { phone: args.phone } : {}),
  });
  if (error) throw error;
  return data;
}

/** "Change coordinator": the current row closes, the next opens (history kept, 4A). */
export async function rpcSetCoordinator(
  memberId: string,
  coordinatorId: string,
  reason: string | null,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("member_set_coordinator", {
    member_id: memberId,
    coordinator_id: coordinatorId,
    ...(reason ? { reason } : {}),
  });
  if (error) throw error;
}

/** Kickoff 4 decision 7: the freelancer's record becomes an invited employee (same id). */
export async function rpcInviteEmployee(memberId: string, email: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("member_invite_employee", {
    member_id: memberId,
    email,
  });
  if (error) throw error;
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

export async function rpcChangeEmail(memberId: string, email: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("member_change_email", {
    member_id: memberId,
    new_email: email,
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

/**
 * Whether an email already belongs to a member, whatever their status (team.manage reads all).
 * An exact match on the lower-cased address, not `ilike`: `_` and `%` are wildcards there and
 * both are legal in an email, so `asha_r@…` would collide with `ashaXr@…`. Every write path
 * stores the address lower-cased (`member_invite`, `member_change_email`, the zod schemas).
 */
export async function findMemberByEmail(email: string): Promise<TeamMember | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("members")
    .select(MEMBER_COLUMNS)
    .eq("email", email.trim().toLowerCase())
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

/**
 * The sign-in for a freelancer who becomes an employee (4A mechanics (10)): created under the
 * freelancer's own id, so their task history and on-behalf rows stay theirs, unconfirmed until
 * they open the invite.
 */
export async function createAuthUserWithId(id: string, email: string): Promise<void> {
  const service = createServiceSupabase();
  const { error } = await service.auth.admin.createUser({ id, email, email_confirm: false });
  if (error) throw error;
}

/**
 * Moves the sign-in itself. `email_confirm` marks the new address confirmed straight away:
 * without it GoTrue would park the change in `email_change` and mail a confirmation, which
 * needs a verified sending domain and a second step from the person (WORKFLOWS §1a).
 */
export async function updateAuthEmail(userId: string, email: string): Promise<void> {
  const service = createServiceSupabase();
  const { error } = await service.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });
  if (error) throw error;
}

/**
 * Puts the sign-in back when `member_change_email()` refused the change. Best effort: if this
 * fails too, the sign-in has moved and the member row has not, so the person signs in with the
 * new address while MaxOff shows the old one. Logged as an error, code only (ARCHITECTURE §18.2).
 */
export async function restoreAuthEmail(userId: string, email: string): Promise<void> {
  try {
    await updateAuthEmail(userId, email);
  } catch {
    console.error("[team] an email change was refused and the sign-in could not be put back");
  }
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

/**
 * The member's own photo (PERMISSIONS §3: a self edit, audited by trigger). The database checks
 * the file is a ready raster image the member uploaded (3.3) and archives the previous one.
 */
export async function setOwnAvatar(id: string, avatarFileId: string | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("members")
    .update({ avatar_file_id: avatarFileId }, { count: "exact" })
    .eq("id", id);
  if (error) throw error;
  if (count === 0) throw new AppError("FORBIDDEN", "Only you can change your photo.");
}
