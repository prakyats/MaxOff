"use client";

import { CheckCheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { bulkSummary } from "@/core/errors/bulk";
import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { toastResult } from "@/core/ui/toast";

import { carryDecide } from "../actions/items";

/** One unfinished item of an ended cycle, as the carry screen shows it. */
export type DecideRow = {
  id: string;
  title: string;
  /** "Planned 30 Sep", or null. */
  planned: string | null;
  /** Left pending before: it is listed again until decided (issue #56 Q2). */
  pending: boolean;
};

/** An ended cycle of one project with its unfinished items. */
export type DecideGroup = {
  cycleId: string;
  href: string;
  projectName: string;
  clientName: string;
  cycleLabel: string;
  /** The client is Inactive: carry forward is refused (decision 13). */
  inactive: boolean;
  /** The client is not Active: the next cycle holds only the carried items for now (Q4 (a)). */
  notActive: boolean;
  rows: DecideRow[];
};

/**
 * The carry screen (7.4; PRODUCT §4.5 "Unfinished items at the end of a cycle", WORKFLOWS §5.3,
 * §5.4 items 11–13, 16; amendment C; Q4 (a); PERMISSIONS: `cycles.carry_decide`, the Owner on any
 * client, the client's Admin on theirs): each ended cycle's open items, grouped by project and
 * cycle. **Carry forward** and **Leave pending** in bulk per cycle (the selected rows, or every row
 * when none is selected); **Close** one item at a time with a reason. Carry forward is not offered
 * on an Inactive client; on a Paused or Draft one the next cycle takes only the carried items until
 * the client is Active (Q4 (a)), which the group says. A failed row keeps its message. Done items
 * are not here: they wait for approval in their own cycle (decision 11).
 */
export function CarryDecider({ groups }: { groups: readonly DecideGroup[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [closing, setClosing] = useState<DecideRow | null>(null);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={CheckCheckIcon}
        title="Nothing to decide."
        description="Unfinished items of an ended cycle show here."
      />
    );
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function decide(group: DecideGroup, decision: "carry_forward" | "leave_pending") {
    const chosen = group.rows.filter((row) => selected.has(row.id));
    const ids = (chosen.length > 0 ? chosen : group.rows).map((row) => row.id);
    setBusy(`${group.cycleId}:${decision}`);
    const result = await carryDecide({ itemIds: ids, decision });
    setBusy(null);
    if (!result.ok) {
      toastResult(result);
      return;
    }
    toast(
      bulkSummary(result.data, decision === "carry_forward" ? "carried forward" : "left pending"),
    );
    setErrors((current) => ({
      ...current,
      ...Object.fromEntries(result.data.failed.map((row) => [row.id, row.message])),
    }));
    setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))));
  }

  return (
    <div className="flex flex-col gap-6" data-slot="carry-decider">
      {groups.map((group) => {
        const chosen = group.rows.filter((row) => selected.has(row.id)).length;
        const count = chosen > 0 ? chosen : group.rows.length;
        return (
          <section
            key={group.cycleId}
            aria-label={`${group.projectName}, ${group.cycleLabel}`}
            data-slot="carry-group"
            className="flex flex-col gap-2"
          >
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-medium break-words">
                <DrillLink href={group.href} className="underline-offset-4 hover:underline">
                  {group.projectName}
                </DrillLink>{" "}
                · {group.cycleLabel}
              </h2>
              <p className="text-muted-foreground text-xs break-words">{group.clientName}</p>
              {group.inactive ? (
                <p className="text-xs" data-slot="carry-inactive">
                  The client is Inactive: close or leave these pending.
                </p>
              ) : group.notActive ? (
                <p className="text-muted-foreground text-xs" data-slot="carry-not-active">
                  The client isn&apos;t Active: the next cycle takes only the carried items until it
                  is.
                </p>
              ) : null}
            </div>
            <ul className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border">
              {group.rows.map((row) => (
                <li
                  key={row.id}
                  data-slot="carry-row"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:px-4"
                >
                  <label className="-ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center">
                    <Checkbox
                      aria-label={`Select ${row.title}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                    />
                  </label>
                  <span className="flex min-w-0 flex-[1_1_8rem] flex-col gap-0.5">
                    <span className="text-sm font-medium break-words">{row.title}</span>
                    <span className="text-muted-foreground text-xs">
                      {[row.planned, row.pending ? "Left pending" : null]
                        .filter(Boolean)
                        .join(" · ") || "No date"}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setClosing(row)}
                    data-slot="carry-close"
                  >
                    Close…
                  </Button>
                  {errors[row.id] ? (
                    <ErrorText className="basis-full">{errors[row.id]}</ErrorText>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className={cn("flex flex-wrap justify-end gap-2")}>
              <Button
                variant="secondary"
                pending={busy === `${group.cycleId}:leave_pending`}
                disabled={busy !== null}
                data-slot="carry-leave-pending"
                onClick={() => void decide(group, "leave_pending")}
              >
                Leave {count} pending
              </Button>
              {group.inactive ? null : (
                <Button
                  variant="secondary"
                  pending={busy === `${group.cycleId}:carry_forward`}
                  disabled={busy !== null}
                  data-slot="carry-forward"
                  onClick={() => void decide(group, "carry_forward")}
                >
                  Carry {count} forward
                </Button>
              )}
            </div>
          </section>
        );
      })}
      <ReasonDialog
        open={closing !== null}
        onOpenChange={(next) => (next ? null : setClosing(null))}
        title={closing ? `Close ${closing.title}?` : "Close the item"}
        description="It stays in its cycle as closed, not done. This can't be undone."
        label="Why close it"
        submitLabel="Close item"
        onSubmit={async (reason) => {
          if (!closing) return;
          const result = await carryDecide({
            itemIds: [closing.id],
            decision: "close",
            reason,
          });
          if (result.ok && result.data.failed[0]) {
            setErrors((current) => ({
              ...current,
              [closing.id]: result.data.failed[0]?.message ?? "",
            }));
            return true;
          }
          return toastResult(result, { success: "Item closed" });
        }}
      />
    </div>
  );
}
