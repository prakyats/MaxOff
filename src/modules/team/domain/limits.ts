/**
 * Input limits the forms show in the browser (`maxLength`, the choices offered). Kept apart from
 * `schemas.ts` so a client component can use them without bundling zod (task 2.8); the schemas
 * import them from here, so both sides keep one number.
 */

/** Who can be invited: never a second Owner (CLAUDE.md invariant 1, WORKFLOWS §1a). */
export const INVITABLE_ROLES = ["admin", "staff"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const NAME_MAX_LENGTH = 120;
export const PHONE_MIN_LENGTH = 3;
export const PHONE_MAX_LENGTH = 32;
export const DEACTIVATE_REASON_MAX_LENGTH = 1000;
