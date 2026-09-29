"use client";

import { useActionState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { updateExpenseReceiptAbove } from "../actions/claims";
import { parseAmount } from "../domain/claims";

/**
 * Settings → Expenses (PRODUCT §4.18, decision 23): the amount above which a claim needs a
 * receipt photo (default ₹500). Zero means every claim needs one. The claim form reads it and
 * the database checks it; changing it never touches a claim already made.
 */
export function ReceiptAboveForm({ receiptAbove }: { receiptAbove: number }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<null> | null, formData: FormData) => {
      const text = String(formData.get("receiptAbove") ?? "").trim();
      const value = text === "0" ? 0 : parseAmount(text);
      if (value === null) {
        return {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "Enter an amount in rupees.",
            fieldErrors: { receiptAbove: ["Enter an amount in rupees, e.g. 500."] },
          },
        } satisfies Result<null>;
      }
      const result = await updateExpenseReceiptAbove({ receiptAbove: value });
      if (result.ok) toast.success("Receipt amount saved");
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} noValidate className="flex max-w-xl flex-col gap-4">
      {error && !error.fieldErrors ? (
        <ErrorText slot="form-alert">{error.message}</ErrorText>
      ) : null}
      <FormField
        label="Receipt photo needed above (₹)"
        hint="A claim for more than this needs a photo of the receipt. 0 means every claim needs one."
        error={error?.fieldErrors?.receiptAbove}
      >
        {(control) => (
          <Input
            {...control}
            name="receiptAbove"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={String(receiptAbove)}
            className="max-w-40"
            required
          />
        )}
      </FormField>
      <StickyActions>
        <Button variant="primary" type="submit" pending={pending} pendingLabel="Saving…">
          Save receipt amount
        </Button>
      </StickyActions>
    </form>
  );
}
