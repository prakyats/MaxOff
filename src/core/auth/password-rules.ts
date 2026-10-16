/**
 * The password length rule, in its own file free of zod: the set-password form (a client
 * component) states it, and importing it from `schemas.ts` shipped the whole schema library to
 * `/set-password` (916 KB first load against `/login`'s 541 KB; P2 item 4). `schemas.ts`
 * builds its rules from these and re-exports them.
 *
 * Mirrors `minimum_password_length` in `supabase/config.toml` and the hosted checklist.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
