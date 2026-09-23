"use client";

import { useActionState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { updateOwnProfile } from "../actions/members";

/** A member's own name and phone (PERMISSIONS §3). Email is the Owner's to change. */
export function ProfileForm({ fullName, phone }: { fullName: string; phone: string | null }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<null> | null, formData: FormData) => {
      const result = await updateOwnProfile({
        fullName: String(formData.get("fullName") ?? ""),
        phone: String(formData.get("phone") ?? ""),
      });
      if (result.ok) toast.success("Profile saved");
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;
  const fieldErrors = error?.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {error && !error.fieldErrors ? (
        <p role="alert" data-slot="form-alert" className="text-destructive text-sm">
          {error.message}
        </p>
      ) : null}
      <FormField label="Full name" error={fieldErrors.fullName}>
        {(control) => (
          <Input
            {...control}
            name="fullName"
            defaultValue={fullName}
            autoComplete="name"
            required
          />
        )}
      </FormField>
      <FormField
        label="Phone"
        hint="A work contact, visible to the Owner and Admins."
        error={fieldErrors.phone}
      >
        {(control) => (
          <Input
            {...control}
            name="phone"
            type="tel"
            defaultValue={phone ?? ""}
            autoComplete="tel"
            inputMode="tel"
          />
        )}
      </FormField>
      {/*
        In the flow, full width on a phone — not a sticky bar. This form is one card among
        several on Me, and a bar pinned to the viewport would still be hanging there while you
        read the Appearance and Session cards below it. Two fields fit on one screen, so the
        button is reachable where it stands (ARCHITECTURE §14.1).
      */}
      <Button type="submit" disabled={pending} className="w-full md:w-auto md:self-start">
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
