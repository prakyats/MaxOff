"use client";

import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import type { Result, ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { DateInput } from "@/core/ui/primitives/date-time-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Input } from "@/core/ui/primitives/input";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError } from "@/core/ui/toast";

import {
  recordAdvance,
  returnAdvance,
  setCycleAmount,
  setDeliverablePrice,
  setProjectAmount,
  setProjectCategory,
} from "../actions/billing";
import {
  BILLING_CATEGORIES,
  BILLING_CATEGORY_LABELS,
  type BillingCategory,
  closedMonthLine,
} from "../domain/billing";
import { parseWholeRupees } from "../domain/money";

/** The longest note an advance carries (the database's check; `domain/schemas` says it too). */
const NOTE_MAX_LENGTH = 500;

/** Which sheet a Billing control opens, with what it needs (built on the server, plain data). */
export type BillingSheetRequest =
  | {
      kind: "amount";
      projectId: string;
      /** "Amount per month", "Amount per week" or "Amount". */
      label: string;
      current: number | null;
      /** Which cycles the amount covers, in words. */
      note: string;
      /** "September is closed. …" when the amount lands in a closed month (v3.5 U5), else null. */
      closed: string | null;
    }
  | {
      kind: "cycleAmount";
      cycleId: string;
      /** "Set this month's amount" / "Set this week's amount". */
      title: string;
      /** "Only November 2026. The project's amount is not changed." */
      note: string;
      /** "September is closed. …" when the cycle's month is closed (v3.5 U5), else null. */
      closed: string | null;
    }
  | { kind: "category"; projectId: string; current: BillingCategory }
  | {
      kind: "price";
      itemId: string;
      title: string;
      current: number | null;
      /** "month" or "week". */
      period: string;
      /** "September is closed. …" when the cycle's month is closed (v3.5 U5), else null. */
      closed: string | null;
    }
  | {
      kind: "advance";
      projectId: string;
      today: string;
      /** The closed months' first days: the line follows the date picked (v3.5 U5). */
      closedMonths: readonly string[];
    }
  | {
      kind: "return";
      advanceId: string;
      /** "₹30,000 received on 15 Nov 2026". */
      summary: string;
      receivedOn: string;
      today: string;
      /** The closed months' first days: the line follows the date picked (v3.5 U5). */
      closedMonths: readonly string[];
    };

/**
 * The Owner's billing sheets (9.2): a bottom sheet on a phone, a dialog on a laptop, one neutral
 * solid commit each and Cancel beside it (ADR-0015); nothing here is red. Amounts are whole
 * rupees, checked here in words, by the action's schema and by the function again.
 */
export function BillingSheet({
  request,
  onClose,
}: {
  request: BillingSheetRequest;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const form = { onClose, onBusy: setBusy };
  return (
    <Dialog open onOpenChange={(open) => (open || busy ? undefined : onClose())}>
      <DialogContent data-slot="billing-sheet" data-kind={request.kind}>
        {request.kind === "amount" ? <AmountForm request={request} {...form} /> : null}
        {request.kind === "cycleAmount" ? <CycleAmountForm request={request} {...form} /> : null}
        {request.kind === "category" ? <CategoryForm request={request} {...form} /> : null}
        {request.kind === "price" ? <PriceForm request={request} {...form} /> : null}
        {request.kind === "advance" ? <AdvanceForm request={request} {...form} /> : null}
        {request.kind === "return" ? <ReturnForm request={request} {...form} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type FormProps<Kind extends BillingSheetRequest["kind"]> = {
  request: Extract<BillingSheetRequest, { kind: Kind }>;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
};

type FieldMessages = Record<string, string | undefined>;

/** What a sheet would send now: the fields to fix first, or the request itself. */
type Attempt = { fix: FieldMessages } | { request: () => Promise<Result<unknown>> };

/**
 * One sheet's commit: one request per tap, built from what is typed **when it runs** (so a Retry
 * after a lost connection sends the corrected fields, never the first attempt's). A refusal keeps
 * what was typed, with a field's message by its field and anything else above the form; a save
 * closes the sheet with a toast.
 */
function useSheetCommit({
  attempt,
  saved,
  onClose,
  onBusy,
  creates = false,
}: {
  attempt: () => Attempt;
  saved: string;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  creates?: boolean;
}) {
  const [fields, setFields] = useState<FieldMessages>({});
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(
    async () => {
      const now = attempt();
      if ("fix" in now) {
        setFields(now.fix);
        return;
      }
      onBusy(true);
      try {
        setError(null);
        const result = await now.request();
        if (!result.ok) {
          const refused = result.error.fieldErrors;
          if (refused && Object.keys(refused).length > 0) {
            setFields(
              Object.fromEntries(Object.entries(refused).map(([key, list]) => [key, list[0]])),
            );
          } else {
            setError(result.error);
          }
          return;
        }
        toast.success(saved);
        onClose();
      } finally {
        onBusy(false);
      }
    },
    { creates },
  );
  const summary = error ? describeError(error) : null;
  return {
    action,
    fields,
    /** Checks the fields first, so a mistyped amount never shows the button working. */
    submit: () => {
      const now = attempt();
      if ("fix" in now) setFields(now.fix);
      else action.run();
    },
    /** A field edited again forgets its message. */
    clear: (key: string) => setFields((current) => ({ ...current, [key]: undefined })),
    alert: summary ? (summary.description ?? summary.title) : null,
  };
}

/**
 * The sheet's frame: its title and line, the closed month's line (v3.5 U5, decision 10: editing
 * stays allowed, the line says the saved report does not follow), the fields, the status line and
 * the two buttons.
 */
function SheetForm({
  title,
  description,
  closed = null,
  alert,
  action,
  submitLabel,
  pendingLabel,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description: ReactNode;
  closed?: string | null;
  alert: string | null;
  action: ReturnType<typeof useSheetCommit>["action"];
  submitLabel: string;
  pendingLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <p
        aria-live="polite"
        data-slot="billing-closed-month"
        className={cn("text-sm break-words", !closed && "hidden")}
      >
        {closed}
      </p>
      {alert ? <ErrorText slot="form-alert">{alert}</ErrorText> : null}
      {children}
      <ActionStatus action={action} />
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          disabled={action.pending}
          data-dismiss=""
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          pending={action.pending}
          pendingLabel={pendingLabel}
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A rupee field: "₹" fixed inside it, whole rupees typed on the number pad. */
function RupeeField({
  label,
  name,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  hint?: string;
}) {
  return (
    <FormField label={`${label} (₹)`} error={error} hint={hint}>
      {(control) => (
        <div className="relative">
          <span
            aria-hidden
            data-slot="amount-prefix"
            className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-base md:text-sm"
          >
            ₹
          </span>
          <Input
            {...control}
            name={name}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 40000"
            className="pl-7 tabular-nums"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      )}
    </FormField>
  );
}

const asText = (amount: number | null): string => (amount === null ? "" : String(amount));

function AmountForm({ request, onClose, onBusy }: FormProps<"amount">) {
  const [text, setText] = useState(asText(request.current));
  const commit = useSheetCommit({
    saved: "Amount saved",
    onClose,
    onBusy,
    attempt: () => {
      const entry = parseWholeRupees(text);
      if (!entry.ok) return { fix: { amount: entry.message } };
      return {
        request: () => setProjectAmount({ projectId: request.projectId, amount: entry.value }),
      };
    },
  });
  return (
    <SheetForm
      title={request.current === null ? "Set the amount" : "Change the amount"}
      description={request.note}
      closed={request.closed}
      alert={commit.alert}
      action={commit.action}
      submitLabel="Save amount"
      pendingLabel="Saving…"
      onClose={onClose}
      onSubmit={commit.submit}
    >
      <RupeeField
        label={request.label}
        name="amount"
        value={text}
        onChange={(next) => {
          setText(next);
          commit.clear("amount");
        }}
        error={commit.fields.amount}
        hint="Whole rupees. ₹0 means not billable."
      />
    </SheetForm>
  );
}

/** One earlier cycle's amount, alone (Q1): the project's amount and other cycles stay. */
function CycleAmountForm({ request, onClose, onBusy }: FormProps<"cycleAmount">) {
  const [text, setText] = useState("");
  const commit = useSheetCommit({
    saved: "Amount saved",
    onClose,
    onBusy,
    attempt: () => {
      const entry = parseWholeRupees(text);
      if (!entry.ok) return { fix: { amount: entry.message } };
      return {
        request: () => setCycleAmount({ cycleId: request.cycleId, amount: entry.value }),
      };
    },
  });
  return (
    <SheetForm
      title={request.title}
      description={request.note}
      closed={request.closed}
      alert={commit.alert}
      action={commit.action}
      submitLabel="Save amount"
      pendingLabel="Saving…"
      onClose={onClose}
      onSubmit={commit.submit}
    >
      <RupeeField
        label="Amount"
        name="amount"
        value={text}
        onChange={(next) => {
          setText(next);
          commit.clear("amount");
        }}
        error={commit.fields.amount}
        hint="Whole rupees. ₹0 means not billable."
      />
    </SheetForm>
  );
}

const CATEGORY_HINTS: Record<BillingCategory, string> = {
  retainer: "Work billed every month or week",
  project: "One piece of work with one amount",
  additional_work: "Extra work outside the usual plan",
};

function CategoryForm({ request, onClose, onBusy }: FormProps<"category">) {
  const [category, setCategory] = useState<BillingCategory>(request.current);
  const commit = useSheetCommit({
    saved: "Category saved",
    onClose,
    onBusy,
    attempt: () => ({
      request: () => setProjectCategory({ projectId: request.projectId, category }),
    }),
  });
  return (
    <SheetForm
      title="Change the category"
      description="How this project's money is grouped in your revenue."
      alert={commit.alert ?? commit.fields.category ?? null}
      action={commit.action}
      submitLabel="Save category"
      pendingLabel="Saving…"
      onClose={onClose}
      onSubmit={commit.submit}
    >
      <fieldset className="flex flex-col gap-2" data-slot="billing-category-choice">
        <legend className="sr-only">Category</legend>
        {BILLING_CATEGORIES.map((option) => (
          <label
            key={option}
            data-slot="billing-category-option"
            className={cn(
              "border-border bg-card flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2",
              "has-[:checked]:border-strong has-[:checked]:bg-strong/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
            )}
          >
            <input
              type="radio"
              name="billing-category"
              value={option}
              checked={category === option}
              onChange={() => setCategory(option)}
              className="accent-strong size-5 shrink-0"
            />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium break-words">{BILLING_CATEGORY_LABELS[option]}</span>
              <span className="text-muted-foreground text-sm break-words">
                {CATEGORY_HINTS[option]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </SheetForm>
  );
}

function PriceForm({ request, onClose, onBusy }: FormProps<"price">) {
  const [text, setText] = useState(asText(request.current));
  const commit = useSheetCommit({
    saved: "Price saved",
    onClose,
    onBusy,
    attempt: () => {
      const entry = parseWholeRupees(text);
      if (!entry.ok) return { fix: { price: entry.message } };
      return { request: () => setDeliverablePrice({ itemId: request.itemId, price: entry.value }) };
    },
  });
  return (
    <SheetForm
      title={request.current === null ? "Set the price" : "Change the price"}
      description={
        <>
          <span className="text-foreground font-medium break-words">{request.title}</span> was added
          this {request.period}. Its price comes on top of the {request.period}&apos;s amount.
        </>
      }
      closed={request.closed}
      alert={commit.alert}
      action={commit.action}
      submitLabel="Save price"
      pendingLabel="Saving…"
      onClose={onClose}
      onSubmit={commit.submit}
    >
      <RupeeField
        label="Price"
        name="price"
        value={text}
        onChange={(next) => {
          setText(next);
          commit.clear("price");
        }}
        error={commit.fields.price}
        hint="Whole rupees. ₹0 means not billable."
      />
    </SheetForm>
  );
}

/** A day up to today, or why not. */
function dayProblem(date: string, today: string, earliest?: string): string | undefined {
  if (!date || date > today) return "Pick a day up to today.";
  if (earliest && date < earliest) return "Pick a day on or after the day it was received.";
  return undefined;
}

function NoteField({
  value,
  onChange,
  error,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  placeholder: string;
}) {
  return (
    <FormField label="Note (optional)" error={error}>
      {(control) => (
        <Textarea
          {...control}
          name="note"
          rows={2}
          maxLength={NOTE_MAX_LENGTH}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

function AdvanceForm({ request, onClose, onBusy }: FormProps<"advance">) {
  const [text, setText] = useState("");
  const [receivedOn, setReceivedOn] = useState(request.today);
  const [note, setNote] = useState("");
  // A lost reply may have recorded it already: no blind Retry (`creates`).
  const commit = useSheetCommit({
    saved: "Advance recorded",
    onClose,
    onBusy,
    creates: true,
    attempt: () => {
      const entry = parseWholeRupees(text, { positive: true });
      const day = dayProblem(receivedOn, request.today);
      if (!entry.ok || day) {
        return { fix: { amount: entry.ok ? undefined : entry.message, receivedOn: day } };
      }
      return {
        request: () =>
          recordAdvance({ projectId: request.projectId, amount: entry.value, receivedOn, note }),
      };
    },
  });
  return (
    <SheetForm
      title="Record an advance"
      description="Money received before delivery. It is not revenue until the project is completed."
      closed={closedMonthLine(receivedOn, request.closedMonths)}
      alert={commit.alert}
      action={commit.action}
      submitLabel="Record advance"
      pendingLabel="Recording…"
      onClose={onClose}
      onSubmit={commit.submit}
    >
      <RupeeField
        label="Amount received"
        name="amount"
        value={text}
        onChange={(next) => {
          setText(next);
          commit.clear("amount");
        }}
        error={commit.fields.amount}
      />
      <FormField label="Date received" error={commit.fields.receivedOn}>
        {(control) => (
          <DateInput
            {...control}
            name="receivedOn"
            max={request.today}
            value={receivedOn}
            onChange={(event) => {
              setReceivedOn(event.target.value);
              commit.clear("receivedOn");
            }}
            required
          />
        )}
      </FormField>
      <NoteField
        value={note}
        onChange={(next) => {
          setNote(next);
          commit.clear("note");
        }}
        error={commit.fields.note}
        placeholder="e.g. 50% on signing, by bank transfer"
      />
    </SheetForm>
  );
}

function ReturnForm({ request, onClose, onBusy }: FormProps<"return">) {
  const [returnedOn, setReturnedOn] = useState(request.today);
  const [note, setNote] = useState("");
  const commit = useSheetCommit({
    saved: "Advance marked returned",
    onClose,
    onBusy,
    attempt: () => {
      const day = dayProblem(returnedOn, request.today, request.receivedOn);
      if (day) return { fix: { returnedOn: day } };
      return { request: () => returnAdvance({ advanceId: request.advanceId, returnedOn, note }) };
    },
  });
  return (
    <SheetForm
      title="Mark the advance returned"
      description={`${request.summary}. It stays in the list, marked as returned.`}
      closed={closedMonthLine(returnedOn, request.closedMonths)}
      alert={commit.alert}
      action={commit.action}
      submitLabel="Mark returned"
      pendingLabel="Saving…"
      onClose={onClose}
      onSubmit={commit.submit}
    >
      <FormField label="Date returned" error={commit.fields.returnedOn}>
        {(control) => (
          <DateInput
            {...control}
            name="returnedOn"
            min={request.receivedOn}
            max={request.today}
            value={returnedOn}
            onChange={(event) => {
              setReturnedOn(event.target.value);
              commit.clear("returnedOn");
            }}
            required
          />
        )}
      </FormField>
      <NoteField
        value={note}
        onChange={(next) => {
          setNote(next);
          commit.clear("note");
        }}
        error={commit.fields.note}
        placeholder="e.g. Project called off, refunded by bank transfer"
      />
    </SheetForm>
  );
}
