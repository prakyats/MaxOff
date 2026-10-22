import { ClockIcon } from "lucide-react";
import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { withSessionUserId } from "@/core/auth/server";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ExtraWorkNotesList, getNoteDays, listOwnNotes } from "@/modules/attendance";
import { AddNoteButton } from "@/modules/attendance/components/add-note-button";
import { CompLeaveCard, getCompBalance, listCredits } from "@/modules/leave";

export const metadata: Metadata = { title: "Extra work & expenses" };

/**
 * The member's extra work (PRODUCT §4.3a, 3b.2), the first view of Extra work & expenses (5B; the layout
 * holds the header and the tabs): the comp leave balance and credits first (the one figure that
 * matters), then the notes, newest first, each with the Owner's outcome, and **Add note** for
 * overtime or a day off worked in the last 7 days. Only whoever marks attendance opens it.
 */
export default async function ExtraWorkPage() {
  const today = todayIST();
  // Keyed by the session's id, so they start with the session read (ARCHITECTURE §19).
  const [, [balance, credits, notes, noteDays]] = await checkThenRead(
    requirePermission("attendance.self"),
    Promise.all([
      withSessionUserId(getCompBalance),
      withSessionUserId(listCredits),
      withSessionUserId(listOwnNotes),
      getNoteDays(today),
    ]),
  );

  return (
    <>
      <CompLeaveCard balance={balance} credits={credits} today={today} />
      {notes.length === 0 ? (
        // FINAL 7 (V5b): the empty list teaches and offers its one action inside it, with no
        // heading row of its own.
        <EmptyState
          icon={ClockIcon}
          title="No extra work noted yet"
          description="Worked late, or on a day off? Add a note and the Owner decides whether it earns comp leave."
          action={<AddNoteButton days={noteDays} variant="strong" />}
        />
      ) : (
        <>
          <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-3">
            <h2 className="text-muted-foreground text-sm font-medium">
              Extra work <span className="tabular-nums">{notes.length}</span>
            </h2>
            <AddNoteButton days={noteDays} />
          </div>
          <ExtraWorkNotesList notes={notes} />
        </>
      )}
    </>
  );
}
