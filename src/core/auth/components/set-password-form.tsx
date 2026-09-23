"use client";

import { useActionState } from "react";

import type { Result } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { setPassword } from "../actions";
import { PASSWORD_MIN_LENGTH } from "../schemas";

import { FormAlert } from "./form-alert";

/** New password + confirmation for the session a recovery or invite link opened. */
export function SetPasswordForm() {
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
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {error && !error.fieldErrors ? <FormAlert>{error.message}</FormAlert> : null}
      <FormField
        label="New password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence works well.`}
        error={fieldErrors.password}
      >
        {(control) => (
          <Input
            {...control}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
          />
        )}
      </FormField>
      <FormField label="Repeat it" error={fieldErrors.confirm}>
        {(control) => (
          <Input {...control} name="confirm" type="password" autoComplete="new-password" required />
        )}
      </FormField>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save password and sign in"}
      </Button>
    </form>
  );
}
