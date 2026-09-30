import { z } from "zod";

/** "Sign out of this device" (5.2): the browser's push endpoint for this device, when it had one. */
export const logoutSchema = z.object({ pushEndpoint: z.url().max(2048).optional() });
export type LogoutInput = z.infer<typeof logoutSchema>;

/** Mirrors `minimum_password_length` in `supabase/config.toml` and the hosted checklist. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const email = z
  .string()
  .trim()
  .min(1, "Enter your email.")
  .max(254, "That email is too long.")
  .pipe(z.email("That doesn't look like an email address."))
  .transform((value) => value.toLowerCase());

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH),
  /** Where to go afterwards; validated by `safeNextPath()`. Too long is dropped, not an error. */
  next: z
    .string()
    .optional()
    .transform((value) => (value && value.length <= 2048 ? value : undefined)),
});
export type LoginInput = z.input<typeof loginSchema>;

export const setPasswordSchema = z
  .object({
    password: newPassword,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "The two passwords don't match.",
  });
export type SetPasswordInput = z.input<typeof setPasswordSchema>;

export const passwordResetSchema = z.object({ email });
export type PasswordResetInput = z.input<typeof passwordResetSchema>;

/**
 * What the Continue page's form posts back (3cB review): the link's own two values, as hidden
 * fields. Whether they name a real, unspent link is `verifyAuthLink()`'s answer, not zod's:
 * anything malformed ends on the same "expired or already used" sign-in page as a spent token.
 */
export const confirmLinkSchema = z.object({
  tokenHash: z.string().max(512),
  type: z.string().max(32),
});
export type ConfirmLinkInput = z.input<typeof confirmLinkSchema>;
