"use client";

import { ListPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import { describeError } from "@/core/ui/toast";

import { keepExtras } from "../actions/bulk";
import { itemCount } from "../domain/items";

/**
 * "Keep this month's extra deliverables next month?" (ROADMAP 6b.16 (d)) on the project page, at
 * the month's end (`extrasCycles`): the deliverables added during the cycle that are not on the
 * deliverables list (`cycleExtras`), named, with **Yes, keep them** (they join the list for the
 * cycles still to be built from it) and **No** (the list stays as it is). Asked once: either answer
 * is recorded (`cycle_keep_extras`) and the card goes. Neutral, never red: it adds to a list,
 * nothing is lost. `projects.manage` only (the Owner, the client's Admin).
 */
export function KeepExtrasPrompt({
  cycleId,
  question,
  titles,
  from,
}: {
  cycleId: string;
  /** "Keep October 2026's extra deliverables next month?" */
  question: string;
  titles: readonly string[];
  /** The first period that would take them ("November 2026"), from the Item list's words. */
  from: string | null;
}) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  if (answered) return null;

  async function answer(keep: boolean) {
    setBusy(keep ? "yes" : "no");
    setError(null);
    const result = await keepExtras({ cycleId, keep });
    setBusy(null);
    if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(description ?? title);
      return;
    }
    setAnswered(true);
    toast.success(
      keep
        ? `${itemCount(result.data.added)} added to the deliverables list${from ? ` from ${from}` : ""}`
        : "The deliverables list stays as it is",
    );
  }

  const shown = titles.slice(0, 4);
  const more = titles.length - shown.length;
  return (
    <section
      aria-label="Extra deliverables"
      data-slot="keep-extras"
      className="border-border bg-card flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm"
    >
      <p className="flex items-start gap-2 font-medium">
        <ListPlusIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{question}</span>
      </p>
      <p className="text-muted-foreground break-words" data-slot="keep-extras-titles">
        {shown.join(", ")}
        {more > 0 ? ` and ${more} more` : ""}. Added this cycle, not on the deliverables list.
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          pending={busy === "no"}
          disabled={busy !== null}
          data-slot="keep-extras-no"
          onClick={() => void answer(false)}
        >
          No
        </Button>
        <Button
          variant="strong"
          pending={busy === "yes"}
          pendingLabel="Adding…"
          disabled={busy !== null}
          data-slot="keep-extras-yes"
          onClick={() => void answer(true)}
        >
          Yes, keep {titles.length === 1 ? "it" : "them"}
        </Button>
      </div>
    </section>
  );
}
