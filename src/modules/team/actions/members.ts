"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";
import { resolveAppOrigin } from "@/core/lib/app-url";
import type { EmailSendResult } from "@/core/notifications/email";
import { sendEmail } from "@/core/notifications/email";
import { assertPermission } from "@/core/permissions/server";

import { emailChangedNewAddressEmail, emailChangedOldAddressEmail } from "../domain/email-change";
import { inviteEmail, inviteLinkFor } from "../domain/invite";
import type { MemberStatus } from "../domain/members";
import {
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
      await repo.deleteAuthUser(userId);
      throw error;
    }

    const link = inviteLinkFor(await appOrigin(), tokenHash, type);
    const sent = await sendEmail(
      inviteEmail({ to: data.email, inviteeName: data.fullName, inviterName: viewer.name, link }),
    );
    revalidatePath(PEOPLE_PATH);
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
    revalidatePath(PEOPLE_PATH);
    return ok({ link: inviteLinkFor(await appOrigin(), tokenHash, type) });
  },
);

export const updateMember = action(async (input: UpdateMemberInput): Promise<Result<null>> => {
  const data = updateMemberSchema.parse(input);
  await assertPermission("team.manage");
  await repo.updateMember(data.memberId, {
    full_name: data.fullName,
    role: data.role,
    job_title_id: data.jobTitleId,
  });
  revalidatePath(PEOPLE_PATH);
  return ok(null);
});

export const updateOwnProfile = action(
  async (input: UpdateOwnProfileInput): Promise<Result<null>> => {
    const data = updateOwnProfileSchema.parse(input);
    const viewer = await getCurrentMember();
    if (!viewer) throw new AppError("UNAUTHENTICATED");
    await repo.updateOwnProfile(viewer.id, { full_name: data.fullName, phone: data.phone });
    revalidatePath("/me");
    revalidatePath(PEOPLE_PATH);
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
    revalidatePath(PEOPLE_PATH);
    revalidatePath("/me");
    // One outcome for both notices: the dialog says "emailed" only when both really went.
    return ok({ email: worstOutcome(sent) });
  },
);

/** Deactivate an active member, or revoke a pending invite: the same transition (WORKFLOWS §1a). */
export const deactivateMember = action(
  async (input: DeactivateMemberInput): Promise<Result<null>> => {
    const data = deactivateMemberSchema.parse(input);
    await assertPermission("team.manage");
    await repo.rpcDeactivate(data.memberId, data.reason);
    revalidatePath(PEOPLE_PATH);
    return ok(null);
  },
);

export const reactivateMember = action(
  async (input: MemberIdInput): Promise<Result<{ status: MemberStatus }>> => {
    const { memberId } = memberIdSchema.parse(input);
    await assertPermission("team.manage");
    const status = await repo.rpcReactivate(memberId);
    revalidatePath(PEOPLE_PATH);
    return ok({ status });
  },
);
