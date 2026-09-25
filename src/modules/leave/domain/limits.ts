/**
 * Input limits the forms show in the browser (`maxLength`, the choices offered). Kept apart from
 * `schemas.ts` so a client component can use them without bundling zod (task 2.8); the schemas
 * import them from here, so both sides keep one number.
 */

export const LEAVE_REASON_MAX_LENGTH = 1000;
export const OWNER_REASON_MIN_LENGTH = 3;
