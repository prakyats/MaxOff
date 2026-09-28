"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";
import { toastResult } from "@/core/ui/toast";

import { grantCompLeave, revokeCompLeave } from "../actions/credits";
import { daysLabel } from "../domain/credits";
import { LEAVE_REASON_MAX_LENGTH } from "../domain/limits";
import { firstName } from "../domain/review";

/**
 * The Owner grants comp leave to a person at any time, independent of any note (PRODUCT §4.3a,
 * decision 14): ½ or 1 day, with an optional note the person sees. The credit expires at the end
 * of this month. `strong` opens the dialog; the commit inside is the layer's one red button.
 */
export function GrantCompLeaveButton({ memberId, name }: { memberId: string; name: string }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<0.5 | 1 | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setDays(null);
      setNote("");
      setError(null);
    }
    setOpen(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await grantCompLeave({ memberId, days: days as 0.5 | 1, note });
      if (toastResult(result, { success: `Comp leave granted to ${firstName(name)}` })) {
        close(false);
        router.refresh();
      } else if (!result.ok) {
        setError(result.error);
      }
    });
  }

  const daysError = error?.fieldErrors?.days?.[0];
  return (
    <>
      <Button variant="strong" size="sm" onClick={() => setOpen(true)} data-slot="grant-comp-leave">
        Grant comp leave
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent data-slot="grant-comp-leave-dialog">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Grant {firstName(name)} comp leave</DialogTitle>
              <DialogDescription>
                It can be used until the end of this month, through a leave request you approve.
              </DialogDescription>
            </DialogHeader>
            {error && !error.fieldErrors ? (
              <ErrorText slot="form-alert">{error.message}</ErrorText>
            ) : null}
            <fieldset className="flex flex-col gap-2" aria-invalid={daysError ? true : undefined}>
              <legend className="mb-1 text-sm font-medium">How much</legend>
              {([1, 0.5] as const).map((option) => (
                <label
                  key={option}
                  data-slot="grant-option"
                  className={cn(
                    "border-border bg-card flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2",
                    "has-[:checked]:border-strong has-[:checked]:bg-strong/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
                  )}
                >
                  <input
                    type="radio"
                    name="days"
                    value={option}
                    checked={days === option}
                    onChange={() => {
                      setDays(option);
                      setError(null);
                    }}
                    className="accent-strong size-5 shrink-0"
                  />
                  <span className="font-medium">{daysLabel(option)}</span>
                </label>
              ))}
              {daysError ? <ErrorText alert={false}>{daysError}</ErrorText> : null}
            </fieldset>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-note`}>A note for {firstName(name)} (optional)</Label>
              <Textarea
                id={`${id}-note`}
                rows={2}
                maxLength={LEAVE_REASON_MAX_LENGTH}
                placeholder="For the Sunday edit."
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => close(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={pending || !days}
                aria-busy={pending}
              >
                {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                Grant {days ? daysLabel(days) : "comp leave"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Revoke an unused grant, with a reason the person reads (decision 17). */
export function RevokeCreditButton({ creditId, name }: { creditId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        data-slot="revoke-credit"
      >
        Revoke
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={`Revoke ${firstName(name)}'s comp leave?`}
        description={`${name} will see this reason.`}
        label="Reason"
        placeholder={`${name} will see this reason.`}
        submitLabel="Revoke comp leave"
        onSubmit={async (reason) => {
          const done = toastResult(await revokeCompLeave({ creditId, reason }), {
            success: "Comp leave revoked",
          });
          if (done) router.refresh();
          return done;
        }}
      />
    </>
  );
}
