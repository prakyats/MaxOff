"use client";

import { useActionState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { updateCompany } from "../actions/settings";
import type { Company } from "../domain/settings";
import { FormError } from "./form-error";

/** Company name and timezone (PRODUCT §4.16). The logo joins in 3.3. */
export function CompanyForm({ company }: { company: Company }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<null> | null, formData: FormData) => {
      const result = await updateCompany({ name: String(formData.get("name") ?? "") });
      if (result.ok) toast.success("Company profile saved");
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} noValidate className="flex max-w-md flex-col gap-4">
      <FormError error={error} />
      <FormField label="Company name" error={error?.fieldErrors?.name}>
        {(control) => (
          <Input
            {...control}
            name="name"
            defaultValue={company.name}
            autoComplete="organization"
            required
          />
        )}
      </FormField>
      <FormField
        label="Timezone"
        hint="MaxOff runs on IST everywhere: attendance days, deadlines and reports all use it."
      >
        {(control) => <Input {...control} value={company.timezone} readOnly disabled />}
      </FormField>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save company"}
        </Button>
      </div>
    </form>
  );
}
