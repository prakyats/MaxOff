"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { Result } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { PasswordInput } from "@/core/ui/composites/password-input";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { login } from "../actions";
import { FORGOT_PASSWORD_PATH } from "../paths";

import { FormAlert } from "./form-alert";

/**
 * Email + password. On success the action redirects (to `next` when it is a safe path, else
 * home), so the form only ever renders a failure. Works at 375px: one column, large targets.
 */
export function LoginForm({ next }: { next?: string | undefined }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<never> | null, formData: FormData) =>
      login({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        ...(next ? { next } : {}),
      }),
    null,
  );
  const error = state && !state.ok ? state.error : null;
  const fieldErrors = error?.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {error && !error.fieldErrors ? <FormAlert>{error.message}</FormAlert> : null}
      <FormField label="Email" error={fieldErrors.email}>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
          />
        )}
      </FormField>
      <FormField label="Password" error={fieldErrors.password}>
        {(control) => (
          <PasswordInput {...control} name="password" autoComplete="current-password" required />
        )}
      </FormField>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        <Link
          href={FORGOT_PASSWORD_PATH}
          className="hover:text-foreground underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
