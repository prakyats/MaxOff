"use client";

import { useActionState } from "react";

import type { Result } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { PasswordInput } from "@/core/ui/composites/password-input";
import { Button } from "@/core/ui/primitives/button";

import { setPassword } from "../actions";
import { PASSWORD_MIN_LENGTH } from "../password-rules";

import { FormAlert } from "./form-alert";

/**
 * New password + confirmation for the session a recovery or invite link opened. `placeholder`
 * draws the same form, disabled and hidden from screen readers, for the page's loading screen
 * while the session is read (v7.5 G4): the same boxes, so nothing moves when it is ready.
 */
export function SetPasswordForm({ placeholder = false }: { placeholder?: boolean }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<never> | null, formData: FormData) =>
      setPassword({
        password: String(formData.get("password") ?? ""),
        confirm: String(formData.get("confirm") ?? ""),
      }),
    null,
  );
  const error = state && !state.ok ? state.error : null;
  const fieldErrors = error?.fieldErrors ?? {};

  return (
    <form
      action={placeholder ? undefined : formAction}
      noValidate
      className="flex flex-col gap-4"
      aria-hidden={placeholder || undefined}
      inert={placeholder || undefined}
      data-placeholder={placeholder || undefined}
    >
      {error && !error.fieldErrors ? <FormAlert>{error.message}</FormAlert> : null}
      <FormField
        label="New password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence works well.`}
        error={fieldErrors.password}
      >
        {(control) => (
          <PasswordInput
            {...control}
            name="password"
            autoComplete="new-password"
            required
            autoFocus={!placeholder}
            disabled={placeholder}
          />
        )}
      </FormField>
      <FormField label="Repeat it" error={fieldErrors.confirm}>
        {(control) => (
          <PasswordInput
            {...control}
            name="confirm"
            autoComplete="new-password"
            required
            disabled={placeholder}
          />
        )}
      </FormField>
      <Button
        variant="primary"
        type="submit"
        className="w-full"
        pending={pending}
        pendingLabel="Saving…"
        disabled={placeholder}
      >
        Save password and sign in
      </Button>
    </form>
  );
}
