import { z } from "zod";

/** Who can be invited: never a second Owner (CLAUDE.md invariant 1, WORKFLOWS §1a). */
export const INVITABLE_ROLES = ["admin", "staff"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const NAME_MAX_LENGTH = 120;
export const PHONE_MIN_LENGTH = 3;
export const PHONE_MAX_LENGTH = 32;
export const DEACTIVATE_REASON_MAX_LENGTH = 1000;

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

export const updateMemberSchema = z.object({
  memberId: z.uuid(),
  fullName,
  /** The Owner row keeps its role: the form never offers a choice for it (the guard refuses anyway). */
  role: z.enum(INVITABLE_ROLES, { error: "Choose Admin or Staff." }).optional(),
  jobTitleId,
});
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;

export const updateOwnProfileSchema = z.object({ fullName, phone });
export type UpdateOwnProfileInput = z.input<typeof updateOwnProfileSchema>;

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
});
export type DeactivateMemberInput = z.input<typeof deactivateMemberSchema>;
