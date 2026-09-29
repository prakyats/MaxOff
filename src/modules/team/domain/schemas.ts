import { z } from "zod";

import {
  INVITABLE_ROLES,
  NAME_MAX_LENGTH,
  PHONE_MIN_LENGTH,
  PHONE_MAX_LENGTH,
  DEACTIVATE_REASON_MAX_LENGTH,
  type InvitableRole,
} from "./limits";

const fullName = z
  .string()
  .trim()
  .min(1, "A name is required.")
  .max(NAME_MAX_LENGTH, `Keep the name under ${NAME_MAX_LENGTH} characters.`);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254, "That email address is too long.");

/** The picker sends "" for "none"; the database stores null. */
const jobTitleId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((value) => (value ? value : null));

const phone = z
  .string()
  .trim()
  .max(PHONE_MAX_LENGTH, `Keep the phone number under ${PHONE_MAX_LENGTH} characters.`)
  .refine((value) => value.length === 0 || value.length >= PHONE_MIN_LENGTH, {
    message: "That phone number is too short.",
  })
  .optional()
  .transform((value) => (value ? value : null));

export const inviteMemberSchema = z.object({
  email,
  fullName,
  role: z.enum(INVITABLE_ROLES, { error: "Choose Admin or Staff." }),
  jobTitleId,
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

/**
 * Where an Admin's clients go before they stop being an Admin (phase 3 review, owner): one move
 * per client, applied before the role change or the deactivation.
 */
const handover = z
  .array(z.object({ clientId: z.uuid(), adminId: z.uuid() }))
  .max(500)
  .optional();

/**
 * Where a coordinator's freelancers go before the coordinator is deactivated (ADR-0013 §2: "first
 * asks where their freelancers go"): one move per active freelancer.
 */
const freelancerMoves = z
  .array(z.object({ memberId: z.uuid(), coordinatorId: z.uuid() }))
  .max(200)
  .optional();

const coordinatorId = z.uuid({ error: "Choose who looks after them." });

const coordinatorReason = z
  .string()
  .trim()
  .max(
    DEACTIVATE_REASON_MAX_LENGTH,
    `Keep the reason under ${DEACTIVATE_REASON_MAX_LENGTH} characters.`,
  )
  .optional()
  .transform((value) => (value ? value : null));

/** "Add person → Freelancer" (PRODUCT §4.17): name, job title, optional phone, the coordinator. */
export const addFreelancerSchema = z.object({ fullName, jobTitleId, phone, coordinatorId });
export type AddFreelancerInput = z.input<typeof addFreelancerSchema>;

export const changeCoordinatorSchema = z.object({
  memberId: z.uuid(),
  coordinatorId,
  reason: coordinatorReason,
});
export type ChangeCoordinatorInput = z.input<typeof changeCoordinatorSchema>;

/** Kickoff 4 decision 7: the email the freelancer will sign in with. */
export const inviteEmployeeSchema = z.object({ memberId: z.uuid(), email });
export type InviteEmployeeInput = z.input<typeof inviteEmployeeSchema>;

/** A freelancer comes back with a coordinator (4A: `member_reactivate` needs one first). */
export const reactivateSchema = z.object({
  memberId: z.uuid(),
  coordinatorId: z.uuid().optional(),
});
export type ReactivateInput = z.input<typeof reactivateSchema>;

export const updateMemberSchema = z.object({
  memberId: z.uuid(),
  fullName,
  /** The Owner row keeps its role: the form never offers a choice for it (the guard refuses anyway). */
  role: z.enum(INVITABLE_ROLES, { error: "Choose Admin or Staff." }).optional(),
  jobTitleId,
  handover,
});
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;

export const updateOwnProfileSchema = z.object({ fullName, phone });
export type UpdateOwnProfileInput = z.input<typeof updateOwnProfileSchema>;

export const changeMemberEmailSchema = z.object({ memberId: z.uuid(), email });
export type ChangeMemberEmailInput = z.input<typeof changeMemberEmailSchema>;

export const memberIdSchema = z.object({ memberId: z.uuid() });
export type MemberIdInput = z.input<typeof memberIdSchema>;

export const deactivateMemberSchema = z.object({
  memberId: z.uuid(),
  reason: z
    .string()
    .trim()
    .max(
      DEACTIVATE_REASON_MAX_LENGTH,
      `Keep the reason under ${DEACTIVATE_REASON_MAX_LENGTH} characters.`,
    )
    .optional()
    .transform((value) => (value ? value : null)),
  handover,
  freelancers: freelancerMoves,
});
export type DeactivateMemberInput = z.input<typeof deactivateMemberSchema>;

export {
  INVITABLE_ROLES,
  NAME_MAX_LENGTH,
  PHONE_MIN_LENGTH,
  PHONE_MAX_LENGTH,
  DEACTIVATE_REASON_MAX_LENGTH,
  type InvitableRole,
};
