"use client";

import { MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import type { Result } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { Button, buttonVariants } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { requestPasswordReset } from "../actions";
import { LOGIN_PATH } from "../paths";

import { FormAlert } from "./form-alert";

/** Asks for the recovery email. The success copy is the same whether or not the address is known. */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<{ sent: true }> | null, formData: FormData) =>
      requestPasswordReset({ email: String(formData.get("email") ?? "") }),
    null,
  );

  if (state?.ok) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
          <MailCheckIcon className="size-5" aria-hidden />
        </div>
        <p className="text-sm font-medium" role="status">
          If that email belongs to a member, a link is on its way.
        </p>
        <p className="text-muted-foreground text-sm">
          The link works once and expires in an hour. Check the spam folder too.
        </p>
        <Link href={LOGIN_PATH} className={buttonVariants({ variant: "outline" })}>
          Back to sign in
        </Link>
      </div>
    );
  }

  const error = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {error && !error.fieldErrors ? <FormAlert>{error.message}</FormAlert> : null}
      <FormField label="Email" error={error?.fieldErrors?.email}>
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
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send me a link"}
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        <Link href={LOGIN_PATH} className="hover:text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
