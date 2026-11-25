"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { useAction } from "@/core/ui/action/use-action";
import { useApprovalGroupsShown } from "@/core/ui/composites/approval-group";
import { PersonAvatar } from "@/core/ui/composites/person-avatar";
import { LIST_ROW_MIN_H } from "@/core/ui/composites/row-metrics";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { describeError, toastResult } from "@/core/ui/toast";

import { clearLate } from "../actions/hours";

/** One Late day as the row shows it: the words are the server's (no clock on hydration). */
export type LateNoNetworkRow = {
  dayId: string;
  memberId: string;
  memberName: string;
  memberAvatarFileId: string | null;
  /** "Started 10:22 am", with the day when it is not today ("Mon, 23 Nov · Started 10:22 am"). */
  started: string;
  /** "Late 22 min". */
  lateChip: string;
  /** "Tried at 9:58 am, no network (phone time)". */
  tried: string;
  /** The reason Clear Late writes, shown on the cleared row until the list is read again. */
  clearedReason: string;
};

/**
 * "Late, no network" in the Owner's Approvals (v7.0; owner Q2, 14 Nov 2026; the approved sample
 * `docs/design/v70-clear-late-sample.html` screen 3; WORKFLOWS §1): Late days whose phone first
 * tried Start day with no network, each with **one tap: Clear Late** (`attendance_clear_late`), no
 * dialog, the reason written for him, then "Late cleared for Asha" with **Undo** (the same function
 * with `undo`). The cleared row stays, faded, as "Late cleared" until the screen is read again.
 * Clear Late is the solid neutral only when it is the screen's one waiting row (ADR-0015).
 */
export function LateNoNetworkGroup({ rows }: { rows: LateNoNetworkRow[] }) {
  const router = useRouter();
  // Rows cleared here: kept on screen, faded, after the refreshed list no longer holds them.
  const [cleared, setCleared] = useState<readonly LateNoNetworkRow[]>([]);
  const groupsShown = useApprovalGroupsShown();
  const clearedIds = new Set(cleared.map((row) => row.dayId));
  const waiting = rows.filter((row) => !clearedIds.has(row.dayId));
  const solid = groupsShown === 1 && waiting.length === 1;
  if (waiting.length === 0 && cleared.length === 0) return null;

  async function undo(row: LateNoNetworkRow) {
    const result = await clearLate({ dayId: row.dayId, undo: true });
    if (toastResult(result, { success: `Late put back for ${row.memberName}` })) {
      setCleared((current) => current.filter((candidate) => candidate.dayId !== row.dayId));
      router.refresh();
    }
  }

  const headingId = "approvals-late-no-network-heading";
  return (
    <section
      id="late-no-network"
      aria-labelledby={headingId}
      data-slot="approval-group"
      data-group="late-no-network"
      className="scroll-mt-20"
    >
      <div className="mb-2 flex min-h-11 items-center">
        <h2 id={headingId} className="text-muted-foreground text-sm font-medium">
          Late, no network{" "}
          <span className="tabular-nums" data-slot="approval-count">
            {waiting.length}
          </span>
          <span className="sr-only"> waiting</span>
        </h2>
      </div>
      <ul className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border">
        {waiting.map((row) => (
          <Row
            key={row.dayId}
            row={row}
            solid={solid}
            onCleared={() => {
              setCleared((current) => [...current, row]);
              router.refresh();
            }}
            onUndo={() => undo(row)}
          />
        ))}
        {cleared.map((row) => (
          <ClearedRow key={row.dayId} row={row} />
        ))}
      </ul>
    </section>
  );
}

function Who({ row }: { row: LateNoNetworkRow }) {
  return (
    <PersonAvatar
      person={{ id: row.memberId, name: row.memberName, avatarFileId: row.memberAvatarFileId }}
      size={20}
    />
  );
}

function Row({
  row,
  solid,
  onCleared,
  onUndo,
}: {
  row: LateNoNetworkRow;
  solid: boolean;
  onCleared: () => void;
  onUndo: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const clear = useAction(async () => {
    setError(null);
    const result = await clearLate({ dayId: row.dayId });
    if (
      toastResult(result, {
        success: `Late cleared for ${row.memberName}`,
        undo: () => void onUndo(),
      })
    ) {
      onCleared();
    } else if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(description ?? title);
    }
  });
  return (
    <li
      data-slot="approval-row"
      data-group="late-no-network"
      data-state="waiting"
      className={cn(
        "flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4",
        LIST_ROW_MIN_H,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Who row={row} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span data-slot="approval-title" className="min-w-0 truncate font-medium">
            {row.memberName}
          </span>
          <span
            data-slot="approval-detail"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          >
            {row.started}
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <StatusBadge status="late" tone="attention" label={row.lateChip} />
          </span>
          <span data-slot="late-tried" className="text-muted-foreground text-sm break-words">
            {row.tried}
          </span>
          {error ? (
            <span data-slot="approval-error" role="status" className="text-destructive text-sm">
              {error}
            </span>
          ) : null}
        </div>
      </div>
      <Button
        variant={solid ? "primary" : "secondary"}
        commits
        className="w-full shrink-0 md:w-auto"
        pending={clear.pending}
        pendingLabel="Clearing…"
        onClick={() => clear.run()}
        data-slot="clear-late"
      >
        Clear Late
      </Button>
    </li>
  );
}

function ClearedRow({ row }: { row: LateNoNetworkRow }) {
  return (
    <li
      data-slot="approval-row"
      data-group="late-no-network"
      data-state="decided"
      className={cn("flex flex-col gap-1 px-4 py-3 opacity-55", LIST_ROW_MIN_H)}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <Who row={row} />
        <span className="min-w-0 truncate font-medium">{row.memberName}</span>
        <StatusBadge status="late_cleared" tone="neutral" label="Late cleared" />
      </span>
      <span className="text-muted-foreground text-sm break-words">
        {row.clearedReason} Cleared by you.
      </span>
    </li>
  );
}
