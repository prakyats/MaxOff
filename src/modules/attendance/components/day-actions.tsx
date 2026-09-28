"use client";

import { Loader2Icon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { useFollowUpTrigger } from "@/core/ui/composites/follow-up";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { endDay, startDay } from "../actions/attendance";
import type { DURATION_OPTIONS } from "../domain/notes";

/**
 * The overtime fields (a select and a note) load when "Worked late? Add an overtime note" is
 * tapped, not with the page: End day sits on the strip of My Day and /today, which hold a
 * first-load budget (`pnpm budget`), and most days end without a note.
 */
const OvertimeNoteFields = dynamic(
  () => import("./overtime-note-fields").then((module) => module.OvertimeNoteFields),
  { ssr: false },
);

/**
 * Start day (PRODUCT §4.2, 3b.1): **the tap is the start**, so there is no confirmation in
 * between (one would move the recorded time). The database refuses a second start, a day off
 * and a day on leave, and the refusal shows as a toast. `size="sm"` on the one-line strip; the
 * 44px touch minimum still applies on a phone.
 */
export function StartDayButton({
  size = "default",
  variant = "primary",
  label = "Start day",
  onStarted,
}: {
  size?: "default" | "sm";
  variant?: "primary" | "strong";
  label?: string;
  /** A caller that closes a layer first refreshes itself once that has happened. */
  onStarted?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      disabled={pending}
      aria-busy={pending}
      data-slot="start-day"
      onClick={() =>
        startTransition(async () => {
          const result = await startDay();
          if (!toastResult(result, { success: "Your day has started" })) return;
          if (onStarted) onStarted();
          else router.refresh();
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  );
}

/**
 * End day: **final for the day, no resume** (kickoff 3b decision 6), so it asks first. The app
 * stays fully usable afterwards. The confirmation carries the optional overtime note (PRODUCT
 * §4.2, 3b.2: the moment someone ends late is the moment they remember it), written in the same
 * transaction as the end; a refused note keeps the confirmation open with the message. After
 * midnight the database closes yesterday's started day.
 *
 * It also asks **"Any expenses to claim today?"** (PRODUCT §4.18, decision 21) when the page put
 * the claim form in a `FollowUpHost` around the strip (the form lives in `modules/expenses`, so
 * the page composes the two): **No** ends the day as before; **Yes** ends it and then opens the
 * form for that day.
 */
export function EndDayButton({
  size = "default",
  yesterday = false,
  noteTaken = false,
  endsOn,
}: {
  size?: "default" | "sm";
  /** The open day is yesterday's (worked past midnight): the copy says so. */
  yesterday?: boolean;
  /** That day already has an overtime note: the confirmation offers none (one per day). */
  noteTaken?: boolean;
  /** The IST date the End day closes (today, or yesterday after midnight). */
  endsOn: string;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [withNote, setWithNote] = useState(false);
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState(false);
  const openClaims = useFollowUpTrigger();

  function reset() {
    setWithNote(false);
    setNote("");
    setMinutes("");
    setError(null);
    setClaim(false);
  }

  return (
    <>
      <Button variant="strong" size={size} onClick={() => setOpen(true)} data-slot="end-day">
        End day
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) reset();
          setOpen(next);
        }}
        title={yesterday ? "End yesterday's day?" : "End your day?"}
        description={
          yesterday
            ? "You never ended yesterday. The end time recorded is now, on yesterday's day. This is final."
            : "The end time is now, and it's final for today: there's no resume. You can keep using MaxOff."
        }
        confirmLabel={claim ? "End day, add expenses" : "End day"}
        onConfirm={async () => {
          const result = await endDay(
            withNote && note.trim()
              ? {
                  overtimeNote: note,
                  overtimeMinutes: minutes
                    ? (Number(minutes) as (typeof DURATION_OPTIONS)[number])
                    : null,
                }
              : {},
          );
          if (!result.ok) {
            setError(result.error.fieldErrors?.overtimeNote?.[0] ?? result.error.message);
            return false;
          }
          toastResult(result, { success: "Your day has ended" });
          router.refresh();
          if (claim && openClaims) openClaims(endsOn);
          return true;
        }}
      >
        {openClaims ? <ExpensesQuestion id={id} claim={claim} onClaim={setClaim} /> : null}
        {withNote ? (
          <OvertimeNoteFields
            id={id}
            minutes={minutes}
            onMinutes={setMinutes}
            note={note}
            onNote={(value) => {
              setNote(value);
              setError(null);
            }}
            error={error}
          />
        ) : noteTaken ? (
          error ? (
            <ErrorText>{error}</ErrorText>
          ) : null
        ) : (
          <div className="flex flex-col gap-2">
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Button
              type="button"
              variant="ghost"
              className="self-start px-0"
              onClick={() => setWithNote(true)}
              data-slot="overtime-note-toggle"
            >
              Worked late? Add an overtime note
            </Button>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

/** "Any expenses to claim today?" No / Yes, inside End day's confirmation (decision 21). */
function ExpensesQuestion({
  id,
  claim,
  onClaim,
}: {
  id: string;
  claim: boolean;
  onClaim: (claim: boolean) => void;
}) {
  const options = [
    { value: false, label: "No" },
    { value: true, label: "Yes" },
  ];
  return (
    <fieldset className="flex flex-col gap-2" data-slot="expenses-question">
      <legend className="mb-1 text-sm font-medium">Any expenses to claim today?</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <label
            key={option.label}
            className={cn(
              "border-border bg-card flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-4",
              "has-[:checked]:border-strong has-[:checked]:bg-strong/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
            )}
          >
            <input
              type="radio"
              name={`${id}-expenses`}
              checked={claim === option.value}
              onChange={() => onClaim(option.value)}
              className="accent-strong size-5 shrink-0"
            />
            <span className="font-medium">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
