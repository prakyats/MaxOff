"use client";

import { CameraIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";

import type { ResultError } from "@/core/errors";
import { acceptFor, checkFile } from "@/core/storage";
import { uploadImageWithPreview } from "@/core/storage/client/upload";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Input } from "@/core/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { submitExpenseClaim } from "../actions/claims";
import {
  CLAIM_NOTE_MAX_LENGTH,
  type ClaimSetup,
  claimWindow,
  formatRupees,
  inClaimWindow,
  parseAmount,
  receiptRequired,
} from "../domain/claims";

type FieldErrors = Partial<
  Record<"amount" | "categoryId" | "expenseDate" | "note" | "receipt", string | undefined>
>;

/**
 * A new expense claim (PRODUCT §4.18, WORKFLOWS §2a, 3b.3): the amount in rupees, a category
 * from the Owner's list, the date, what it was for, and a receipt photo, **needed above the
 * Owner's amount** (default ₹500). The photo goes up first through `core/storage` (the original
 * untouched, a small preview beside it), then the claim names it. `setup` (the categories and
 * the receipt amount) arrives as a promise, read inside a Suspense boundary.
 *
 * `several` (End day's "Yes"): after a claim is added the form empties for the next one and
 * lists what was added, until **Done**. Otherwise it closes on success.
 */
export function ExpenseClaimDialog({
  today,
  date,
  setup,
  several = false,
  onClose,
}: {
  today: string;
  /** The day the form starts on (End day: the day that ended). */
  date?: string;
  setup: Promise<ClaimSetup | null>;
  several?: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => (open || busy ? undefined : onClose())}>
      <DialogContent data-slot="expense-claim-dialog">
        <DialogHeader>
          <DialogTitle>{several ? "Expenses to claim" : "Add an expense"}</DialogTitle>
          <DialogDescription>
            The Owner approves it and pays it with your salary. You can withdraw it while it waits.
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<FormSkeleton />}>
          <ClaimForm
            today={today}
            initialDate={date && inClaimWindow(date, today) ? date : today}
            setup={setup}
            several={several}
            onClose={onClose}
            onBusy={setBusy}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}

/** The fields' tracing while the setup loads: amount and category, date, note, photo, buttons. */
function FormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4" data-slot="expense-form-skeleton">
      <div className="flex flex-col gap-4 sm:flex-row">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 flex-1" />
      </div>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-11 w-44" />
      <div className="flex justify-end gap-2">
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-11 w-32" />
      </div>
    </div>
  );
}

type Added = { key: string; label: string };

function ClaimForm({
  today,
  initialDate,
  setup,
  several,
  onClose,
  onBusy,
}: {
  today: string;
  initialDate: string;
  setup: Promise<ClaimSetup | null>;
  several: boolean;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const router = useRouter();
  const loaded = use(setup);
  const fileInput = useRef<HTMLInputElement>(null);
  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(initialDate);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // The upload that already went up for this photo, so a refused claim is retried without it.
  const [uploaded, setUploaded] = useState<{ file: File; fileId: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<ResultError | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [added, setAdded] = useState<Added[]>([]);

  // The chosen photo, shown before it goes up; the object URL is released with it.
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  // One request per tap: the photo goes up, then the claim; a slow or failed one is said under
  // the buttons and what was typed stays (ARCHITECTURE §14.1).
  const action = useAction(async (amount: number) => {
    onBusy(true);
    try {
      let receiptFileId: string | null = null;
      if (file) {
        if (uploaded?.file === file) {
          receiptFileId = uploaded.fileId;
        } else {
          setPhase("uploading");
          const outcome = await uploadImageWithPreview({ purpose: "receipt", file });
          if (!outcome.ok) {
            setFieldErrors({ receipt: outcome.message });
            return;
          }
          setUploaded({ file, fileId: outcome.fileId });
          receiptFileId = outcome.fileId;
        }
      }
      setPhase("saving");
      const result = await submitExpenseClaim({
        expenseDate,
        amount,
        categoryId,
        note,
        receiptFileId,
      });
      if (!result.ok) {
        const fields = result.error.fieldErrors;
        if (fields) {
          setFieldErrors({
            amount: fields.amount?.[0],
            categoryId: fields.categoryId?.[0],
            expenseDate: fields.expenseDate?.[0],
            note: fields.note?.[0],
          });
        } else {
          setError(result.error);
        }
        return;
      }
      const category = loaded?.categories.find((option) => option.id === categoryId)?.name ?? "";
      toastResult(result, { success: "Expense claim added" });
      router.refresh();
      if (!several) {
        onClose();
        return;
      }
      setAdded((current) => [
        ...current,
        { key: result.data.claimId, label: `${formatRupees(amount)} · ${category}` },
      ]);
      setAmountText("");
      setNote("");
      setFile(null);
      setUploaded(null);
      setFieldErrors({});
    } finally {
      setPhase("idle");
      onBusy(false);
    }
  });

  if (!loaded) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorText slot="form-alert">
          The categories could not be loaded. Close this and try again.
        </ErrorText>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }
  const { categories, receiptAbove } = loaded;
  const range = claimWindow(today);
  const amount = parseAmount(amountText);
  const needsReceipt = amount !== null && receiptRequired(amount, receiptAbove);
  const { pending } = action;

  function clearError(key: keyof FieldErrors) {
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setError(null);
  }

  function pick(next: File | null) {
    if (next) {
      const problem = checkFile("receipt", { mime: next.type, size: next.size });
      if (problem) {
        setFieldErrors((current) => ({ ...current, receipt: problem }));
        return;
      }
    }
    setFile(next);
    clearError("receipt");
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (amount === null) errors.amount = "Enter the amount in rupees, e.g. 250 or 250.50.";
    if (!categoryId) errors.categoryId = "Choose a category.";
    if (!expenseDate || expenseDate > today) errors.expenseDate = "Pick a day up to today.";
    else if (!inClaimWindow(expenseDate, today))
      errors.expenseDate = "Claims are for this month (and last month until the 5th).";
    if (!note.trim()) errors.note = "Say what it was for.";
    if (needsReceipt && !file)
      errors.receipt = `Add a receipt photo: it's needed above ${formatRupees(receiptAbove)}.`;
    return errors;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate();
    if (Object.values(errors).some(Boolean) || amount === null) {
      setFieldErrors(errors);
      return;
    }
    action.run(amount);
  }

  const summary = error ? describeError(error) : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {added.length > 0 ? (
        <div data-slot="claims-added" className="bg-muted rounded-lg px-4 py-3 text-sm">
          <p className="font-medium">
            Added {added.length === 1 ? "1 claim" : `${added.length} claims`}
          </p>
          <ul className="text-muted-foreground mt-1 flex flex-col gap-0.5">
            {added.map((item) => (
              <li key={item.key} className="tabular-nums">
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row">
        <FormField label="Amount (₹)" error={fieldErrors.amount} className="flex-1">
          {(control) => (
            <Input
              {...control}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="250"
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value);
                clearError("amount");
              }}
            />
          )}
        </FormField>
        <FormField label="Category" error={fieldErrors.categoryId} className="flex-1">
          {(control) => (
            <Select
              value={categoryId}
              onValueChange={(next) => {
                setCategoryId(next);
                clearError("categoryId");
              }}
            >
              <SelectTrigger
                id={control.id}
                className="w-full"
                aria-describedby={control["aria-describedby"]}
                aria-invalid={control["aria-invalid"]}
              >
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
      <FormField label="Date" error={fieldErrors.expenseDate}>
        {(control) => (
          <Input
            {...control}
            name="expenseDate"
            type="date"
            min={range.from}
            max={range.to}
            value={expenseDate}
            onChange={(event) => {
              setExpenseDate(event.target.value);
              clearError("expenseDate");
            }}
            required
          />
        )}
      </FormField>
      <FormField label="What was it for?" error={fieldErrors.note}>
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={2}
            maxLength={CLAIM_NOTE_MAX_LENGTH}
            placeholder="Auto to the shoot at Indiranagar"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              clearError("note");
            }}
          />
        )}
      </FormField>
      <div className="flex flex-col gap-1.5" data-slot="receipt-field">
        <span className="text-sm font-medium">
          Receipt photo{" "}
          <span className="text-muted-foreground font-normal">
            {needsReceipt ? "(needed)" : "(optional)"}
          </span>
        </span>
        <input
          ref={fileInput}
          type="file"
          accept={acceptFor("receipt")}
          className="sr-only"
          tabIndex={-1}
          aria-label="Receipt photo"
          data-slot="receipt-input"
          onChange={(event) => {
            pick(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        {file && previewUrl ? (
          <div className="border-border flex items-center gap-3 rounded-lg border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, never fetched */}
            <img
              src={previewUrl}
              alt="The receipt you chose"
              className="size-14 shrink-0 rounded object-cover"
            />
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove the receipt photo"
              disabled={pending}
              onClick={() => pick(null)}
            >
              <XIcon aria-hidden />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            disabled={pending}
            onClick={() => fileInput.current?.click()}
          >
            <CameraIcon aria-hidden />
            Add receipt photo
          </Button>
        )}
        {fieldErrors.receipt ? (
          <ErrorText>{fieldErrors.receipt}</ErrorText>
        ) : (
          <p className="text-muted-foreground text-xs">
            Needed above {formatRupees(receiptAbove)}. Only you and the Owner see it.
          </p>
        )}
      </div>
      <ActionStatus action={action} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
          {several && added.length > 0 ? "Done" : "Cancel"}
        </Button>
        <Button
          variant="primary"
          type="submit"
          pending={pending}
          pendingLabel={
            phase === "uploading"
              ? "Uploading photo…"
              : several && added.length > 0
                ? "Adding another…"
                : "Adding claim…"
          }
        >
          {several && added.length > 0 ? "Add another" : "Add claim"}
        </Button>
      </DialogFooter>
    </form>
  );
}
