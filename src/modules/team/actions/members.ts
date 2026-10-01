"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { PASSWORD_MIN_LENGTH } from "@/core/auth";
import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";
import { resolveAppOrigin } from "@/core/lib/app-url";
import type { EmailSendResult } from "@/core/notifications/email";
import { sendEmail } from "@/core/notifications/email";
import { assertPermission } from "@/core/permissions/server";
import { handOverClients, listClientsRunBy } from "@/modules/clients";
import { countOpenAssignments } from "@/modules/tasks";

import { emailChangedNewAddressEmail, emailChangedOldAddressEmail } from "../domain/email-change";
import { inviteEmail, inviteLinkFor } from "../domain/invite";
import {
  coordinatorOptions,
  inviteAsEmployeeRefusal,
  LEFTOVER_SIGN_IN_MESSAGE,
  type MemberStatus,
} from "../domain/members";
import {
  type AddFreelancerInput,
  addFreelancerSchema,
  type ChangeCoordinatorInput,
  changeCoordinatorSchema,
  type InviteEmployeeInput,
  inviteEmployeeSchema,
  type ReactivateInput,
  reactivateSchema,
  type ChangeMemberEmailInput,
  changeMemberEmailSchema,
  type DeactivateMemberInput,
  deactivateMemberSchema,
  type InviteMemberInput,
  inviteMemberSchema,
  type MemberIdInput,
  memberIdSchema,
  type UpdateMemberInput,
  updateMemberSchema,
  type UpdateOwnProfileInput,
  updateOwnProfileSchema,
} from "../domain/schemas";
import * as repo from "../data/members";

/**
 * Team actions (ARCHITECTURE §4.2): zod → `assertPermission()` → repository → revalidate →
 * `Result`. State changes go through the transition functions; the invite also talks to the
 * Auth admin API, since a sign-in must exist before its member row.
 */

export type EmailOutcome = "sent" | "not_configured" | "failed";

function outcomeOf(result: EmailSendResult): EmailOutcome {
  if (result.ok) return "sent";
  return result.reason === "not_configured" ? "not_configured" : "failed";
}

/** Several notices, one answer: the UI must not claim "emailed" when one of them did not go. */
function worstOutcome(results: readonly EmailSendResult[]): EmailOutcome {
  const outcomes = results.map(outcomeOf);
  if (outcomes.includes("failed")) return "failed";
  if (outcomes.includes("not_configured")) return "not_configured";
  return "sent";
}

export type InviteOutcome = {
  memberId: string;
  /** Shown once, with a Copy button; never stored. */
  link: string;
  email: EmailOutcome;
};

/** Revalidated as a layout: the list and every person's page (3.4) read the same rows. */
const PEOPLE_PATH = "/people";

/**
 * The origin invite links are built on. Outside local runs a missing NEXT_PUBLIC_APP_URL is a
 * build mistake and fails loud rather than mailing links on whatever Host header arrived.
 */
async function appOrigin(): Promise<string> {
  const h = await headers();
  return resolveAppOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    h.get("x-forwarded-host") ?? h.get("host"),
    h.get("x-forwarded-proto"),
    process.env.NEXT_PUBLIC_APP_ENV,
  );
}

export const inviteMember = action(
  async (input: InviteMemberInput): Promise<Result<InviteOutcome>> => {
    const data = inviteMemberSchema.parse(input);
    const viewer = await assertPermission("team.manage");

    // Checked before any token is issued: generateLink for a pending person would rotate (and
    // kill) the link they were emailed, only for member_invite() to answer CONFLICT.
    if (await repo.findMemberByEmail(data.email)) {
      throw new AppError(
        "CONFLICT",
        "Someone with this email is already on the team. Reactivate them instead.",
      );
    }

    const { userId, tokenHash, type } = await repo.issueInviteToken(data.email);
    try {
      await repo.rpcInvite({
        user_id: userId,
        email: data.email,
        full_name: data.fullName,
        role: data.role,
        job_title_id: data.jobTitleId,
      });
    } catch (error) {
      if (!(await repo.deleteAuthUser(userId))) {
        throw new AppError("INTERNAL", LEFTOVER_SIGN_IN_MESSAGE, { cause: error });
      }
      throw error;
    }

    const link = inviteLinkFor(await appOrigin(), tokenHash, type);
    const sent = await sendEmail(
      inviteEmail({
        to: data.email,
        inviteeName: data.fullName,
        inviterName: viewer.name,
        link,
        passwordMinLength: PASSWORD_MIN_LENGTH,
      }),
    );
    revalidatePath(PEOPLE_PATH, "layout");
    return ok({ memberId: userId, link, email: outcomeOf(sent) });
  },
);

/** "Copy invite link": a fresh link for a pending invite. The previous link stops working. */
export const issueInviteLink = action(
  async (input: MemberIdInput): Promise<Result<{ link: string }>> => {
    const { memberId } = memberIdSchema.parse(input);
    await assertPermission("team.manage");

    await repo.rpcRefreshInvite(memberId);
    const member = await repo.getOwnMember(memberId); // RLS: team.manage reads every row
    if (!member?.email) throw new AppError("NOT_FOUND", "This person is not on the team.");
    const { tokenHash, type } = await repo.issueInviteToken(member.email);
    revalidatePath(PEOPLE_PATH, "layout");
    return ok({ link: inviteLinkFor(await appOrigin(), tokenHash, type) });
  },
);

export type ClientHandoverData = {
  clients: { id: string; name: string }[];
  /** Every other active Admin, by name: who may take the clients. */
  admins: { id: string; name: string }[];
};

/**
 * What an Admin runs and who may take it, read when the Owner opens a demotion or a deactivation
 * (phase 3 review, owner: no client is ever left without an Admin).
 */
export const getClientHandover = action(
  async (input: MemberIdInput): Promise<Result<ClientHandoverData>> => {
    const { memberId } = memberIdSchema.parse(input);
    await assertPermission("team.manage");
    const [clients, members] = await Promise.all([listClientsRunBy(memberId), repo.listMembers()]);
    const admins = members
      .filter((member) => member.role === "admin" && member.status === "active")
      .filter((member) => member.id !== memberId)
      .map((member) => ({ id: member.id, name: member.fullName }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return ok({ clients, admins });
  },
);

/** The clients move first; the database refuses the change while any is left (CONFLICT). */
async function handOver(
  memberId: string,
  moves: readonly { clientId: string; adminId: string }[] | undefined,
) {
  if (!moves || moves.length === 0) return;
  await assertPermission("clients.manage");
  await handOverClients(memberId, moves);
}

export const updateMember = action(async (input: UpdateMemberInput): Promise<Result<null>> => {
  const data = updateMemberSchema.parse(input);
  await assertPermission("team.manage");
  await handOver(data.memberId, data.handover);
  await repo.updateMember(data.memberId, {
    full_name: data.fullName,
    role: data.role,
    job_title_id: data.jobTitleId,
  });
  revalidatePath(PEOPLE_PATH, "layout");
  if (data.handover?.length) revalidatePath("/clients", "layout");
  return ok(null);
});

export const updateOwnProfile = action(
  async (input: UpdateOwnProfileInput): Promise<Result<null>> => {
    const data = updateOwnProfileSchema.parse(input);
    const viewer = await getCurrentMember();
    if (!viewer) throw new AppError("UNAUTHENTICATED");
    await repo.updateOwnProfile(viewer.id, { full_name: data.fullName, phone: data.phone });
    revalidatePath("/me");
    revalidatePath(PEOPLE_PATH, "layout");
    return ok(null);
  },
);

/**
 * The Owner moves a member's login identity (WORKFLOWS §1a). Two systems, in this order: the
 * sign-in at GoTrue first, then the member row, because `member_change_email()` refuses a row
 * whose sign-in still carries the old address — the drift that would lock the person out. If
 * the function refuses anything (a conflict, a deactivated person), the sign-in goes back.
 * Both addresses are then told, and neither email failing undoes the change.
 */
export const changeMemberEmail = action(
  async (input: ChangeMemberEmailInput): Promise<Result<{ email: EmailOutcome }>> => {
    const data = changeMemberEmailSchema.parse(input);
    const viewer = await assertPermission("team.manage");

    const member = await repo.getOwnMember(data.memberId); // RLS: team.manage reads every row
    if (!member?.email) throw new AppError("NOT_FOUND", "This person is not on the team.");
    const oldEmail = member.email;
    if (member.status === "deactivated") {
      // Mirrors member_change_email(). GoTrue is the side that cannot be rolled back reliably,
      // so every precondition the rpc will refuse is checked before the sign-in is touched.
      throw new AppError("INVALID_STATE", "Reactivate this person before changing their email.");
    }
    if (oldEmail === data.email) {
      throw new AppError("VALIDATION", "That is already their email address.");
    }
    const clash = await repo.findMemberByEmail(data.email);
    if (clash) {
      throw new AppError("CONFLICT", "Someone on the team already signs in with that address.");
    }

    await repo.updateAuthEmail(data.memberId, data.email);
    try {
      await repo.rpcChangeEmail(data.memberId, data.email);
    } catch (error) {
      await repo.restoreAuthEmail(data.memberId, oldEmail);
      throw error;
    }

    const notice = {
      memberName: member.fullName,
      oldEmail,
      newEmail: data.email,
      changedBy: viewer.name,
      accepted: member.status === "active",
    };
    const sent = await Promise.all([
      sendEmail(emailChangedNewAddressEmail(notice)),
      sendEmail(emailChangedOldAddressEmail(notice)),
    ]);
    revalidatePath(PEOPLE_PATH, "layout");
    revalidatePath("/me");
    // One outcome for both notices: the dialog says "emailed" only when both really went.
    return ok({ email: worstOutcome(sent) });
  },
);

/** The reason a freelancer's move carries when their coordinator leaves (Owner and Admins read it). */
const MOVED_REASON = "Their coordinator was deactivated";

/**
 * Deactivate an active member, or revoke a pending invite: the same transition (WORKFLOWS §1a).
 * An Admin's clients move first (phase 3 review), and so do a coordinator's freelancers (ADR-0013
 * §2: `member_deactivate()` refuses while an active freelancer points at them): each move is a
 * `member_set_coordinator`, then the deactivation. Two steps, as the client hand-over: if the
 * second fails, the freelancers have already moved, which the rule allows.
 */
export const deactivateMember = action(
  async (input: DeactivateMemberInput): Promise<Result<null>> => {
    const data = deactivateMemberSchema.parse(input);
    await assertPermission("team.manage");
    await handOver(data.memberId, data.handover);
    for (const move of data.freelancers ?? []) {
      await repo.rpcSetCoordinator(move.memberId, move.coordinatorId, MOVED_REASON);
    }
    await repo.rpcDeactivate(data.memberId, data.reason);
    revalidatePath(PEOPLE_PATH, "layout");
    revalidatePath("/clients", "layout");
    revalidatePath("/me");
    return ok(null);
  },
);

/**
 * Reactivate (WORKFLOWS §1a). A freelancer comes back only with a coordinator (4A decision (a),
 * `member_reactivate()` answers INVALID_STATE without one): the dialog names one and it is set
 * first.
 */
export const reactivateMember = action(
  async (input: ReactivateInput): Promise<Result<{ status: MemberStatus }>> => {
    const { memberId, coordinatorId } = reactivateSchema.parse(input);
    await assertPermission("team.manage");
    if (coordinatorId) await repo.rpcSetCoordinator(memberId, coordinatorId, null);
    const status = await repo.rpcReactivate(memberId);
    revalidatePath(PEOPLE_PATH, "layout");
    return ok({ status });
  },
);

/** "Add person → Freelancer" (PRODUCT §4.17, ADR-0013): no invite, no sign-in, a coordinator. */
export const addFreelancer = action(
  async (input: AddFreelancerInput): Promise<Result<{ memberId: string }>> => {
    const data = addFreelancerSchema.parse(input);
    await assertPermission("team.manage");
    const memberId = await repo.rpcAddFreelancer(data);
    revalidatePath(PEOPLE_PATH, "layout");
    revalidatePath("/me");
    return ok({ memberId });
  },
);

/** "Change coordinator": the history keeps who, when and why (the why is the Owner's and Admins'). */
export const changeCoordinator = action(
  async (input: ChangeCoordinatorInput): Promise<Result<null>> => {
    const data = changeCoordinatorSchema.parse(input);
    await assertPermission("team.manage");
    await repo.rpcSetCoordinator(data.memberId, data.coordinatorId, data.reason);
    revalidatePath(PEOPLE_PATH, "layout");
    revalidatePath("/me");
    revalidatePath("/tasks", "layout");
    return ok(null);
  },
);

export type CoordinatorChoices = {
  /** The freelancer's current coordinator, if any (none once deactivated). */
  current: { id: string; name: string } | null;
  /** Who may coordinate: every active permanent Admin or Staff member but the current one. */
  options: { id: string; name: string }[];
};

/** Read when the Owner opens "Change coordinator" or a freelancer's reactivation (ADR-0013). */
export const getCoordinatorChoices = action(
  async (input: MemberIdInput): Promise<Result<CoordinatorChoices>> => {
    const { memberId } = memberIdSchema.parse(input);
    await assertPermission("team.manage");
    const [coordinators, members] = await Promise.all([
      repo.listCurrentCoordinators(),
      repo.listMembers(),
    ]);
    const currentId = coordinators[memberId] ?? null;
    const current = currentId ? members.find((member) => member.id === currentId) : undefined;
    return ok({
      current: current ? { id: current.id, name: current.fullName } : null,
      options: coordinatorOptions(members, [memberId, ...(currentId ? [currentId] : [])]),
    });
  },
);

export type FreelancerHandoverData = {
  freelancers: { id: string; name: string }[];
  /** Who may take them: every other active permanent Admin or Staff member (decision 8). */
  coordinators: { id: string; name: string }[];
};

/**
 * The freelancers a person looks after now, and who may take them, read when the Owner opens a
 * deactivation (ADR-0013 §2: deactivating a coordinator first asks where their freelancers go).
 */
export const getFreelancerHandover = action(
  async (input: MemberIdInput): Promise<Result<FreelancerHandoverData>> => {
    const { memberId } = memberIdSchema.parse(input);
    await assertPermission("team.manage");
    const [coordinators, members] = await Promise.all([
      repo.listCurrentCoordinators(),
      repo.listMembers(),
    ]);
    const names = new Map(members.map((member) => [member.id, member]));
    const freelancers = Object.entries(coordinators)
      .filter(
        ([freelancer, coordinator]) =>
          coordinator === memberId && names.get(freelancer)?.status === "active",
      )
      .map(([freelancer]) => ({ id: freelancer, name: names.get(freelancer)?.fullName ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return ok({ freelancers, coordinators: coordinatorOptions(members, [memberId]) });
  },
);

/** The freelancer's open tasks, for the warning in "Invite as employee" (4A later item L5). */
export const getOpenTaskCount = action(
  async (input: MemberIdInput): Promise<Result<{ openTasks: number }>> => {
    const { memberId } = memberIdSchema.parse(input);
    await assertPermission("team.manage");
    return ok({ openTasks: await countOpenAssignments(memberId) });
  },
);

/**
 * "Invite as employee" (Kickoff 4 decision 7, WORKFLOWS §1b): the sign-in is created **under the
 * freelancer's own id** (4A mechanics (10)), then `member_invite_employee()` makes the record an
 * invited employee (same id, the coordinator row closed), then the invite link is issued and
 * mailed exactly as for any invite. Only an active freelancer, checked before the sign-in is
 * created; the sign-in is removed again if the function refuses, and a removal that fails is
 * reported and told to the Owner (phase 4 review S-S3).
 */
export const inviteAsEmployee = action(
  async (input: InviteEmployeeInput): Promise<Result<InviteOutcome>> => {
    const data = inviteEmployeeSchema.parse(input);
    const viewer = await assertPermission("team.manage");
    if (await repo.findMemberByEmail(data.email)) {
      throw new AppError("CONFLICT", "Someone with this email is already on the team.", {
        fieldErrors: { email: ["Someone with this email is already on the team."] },
      });
    }
    const member = await repo.getOwnMember(data.memberId); // RLS: team.manage reads every row
    if (!member) throw new AppError("NOT_FOUND", "This person is not on the team.");
    // Before any sign-in exists under their id (phase 4 review S-S3): only an active freelancer.
    const refusal = inviteAsEmployeeRefusal(member);
    if (refusal) throw new AppError("INVALID_STATE", refusal);

    await repo.createAuthUserWithId(data.memberId, data.email);
    try {
      await repo.rpcInviteEmployee(data.memberId, data.email);
    } catch (error) {
      if (!(await repo.deleteAuthUser(data.memberId))) {
        throw new AppError("INTERNAL", LEFTOVER_SIGN_IN_MESSAGE, { cause: error });
      }
      throw error;
    }
    const { tokenHash, type } = await repo.issueInviteToken(data.email);
    const link = inviteLinkFor(await appOrigin(), tokenHash, type);
    const sent = await sendEmail(
      inviteEmail({
        to: data.email,
        inviteeName: member.fullName,
        inviterName: viewer.name,
        link,
        passwordMinLength: PASSWORD_MIN_LENGTH,
      }),
    );
    revalidatePath(PEOPLE_PATH, "layout");
    revalidatePath("/tasks", "layout");
    return ok({ memberId: data.memberId, link, email: outcomeOf(sent) });
  },
);

const avatarSchema = z.object({ fileId: z.uuid() });
export type SetOwnAvatarInput = z.input<typeof avatarSchema>;

/** The member's own photo (3.3): the uploaded original; lists show its browser-made preview. */
export const setOwnAvatar = action(async (input: SetOwnAvatarInput): Promise<Result<null>> => {
  const { fileId } = avatarSchema.parse(input);
  const viewer = await getCurrentMember();
  if (!viewer) throw new AppError("UNAUTHENTICATED");
  await repo.setOwnAvatar(viewer.id, fileId);
  revalidatePath("/me");
  revalidatePath(PEOPLE_PATH, "layout");
  return ok(null);
});

export const removeOwnAvatar = action(async (): Promise<Result<null>> => {
  const viewer = await getCurrentMember();
  if (!viewer) throw new AppError("UNAUTHENTICATED");
  await repo.setOwnAvatar(viewer.id, null);
  revalidatePath("/me");
  revalidatePath(PEOPLE_PATH, "layout");
  return ok(null);
});
