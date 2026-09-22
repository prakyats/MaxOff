import { z } from "zod";

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
