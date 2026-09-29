"use client";

import { useActionState } from "react";

import type { Result } from "@/core/errors";
import { Button } from "@/core/ui/primitives/button";

import { confirmAuthLink } from "../actions";

import { FormAlert } from "./form-alert";

/**
 * "Continue to MaxOff" (3cB review): the link's two values as hidden fields and one solid
 * commit button. Submitting is what verifies the one-time token; until then the link is
 * unspent. The action redirects on every outcome, so the form only ever renders a failure it
 * could not turn into a redirect (the database unreachable, say).
 */
export function ContinueForm({ tokenHash, type }: { tokenHash: string; type: string }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<never> | null, formData: FormData) =>
      confirmAuthLink({
        tokenHash: String(formData.get("token_hash") ?? ""),
        type: String(formData.get("type") ?? ""),
      }),
    null,
  );
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {error ? <FormAlert>{error.message}</FormAlert> : null}
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <Button variant="primary" type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? "Opening…" : "Continue to MaxOff"}
      </Button>
    </form>
  );
}
