import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { ExtraWorkNotesList, getNoteDays, listOwnNotes } from "@/modules/attendance";
import { AddNoteButton } from "@/modules/attendance/components/add-note-button";
import { CompLeaveCard, getCompBalance, listCredits } from "@/modules/leave";

export const metadata: Metadata = { title: "Attendance & leave" };

/**
 * The member's extra work (PRODUCT §4.3a, 3b.2), a third view of Attendance & leave (the layout
 * holds the header and the tabs): the comp leave balance and credits first (the one figure that
 * matters), then the notes, newest first, each with the Owner's outcome, and **Add note** for
 * overtime or a day off worked in the last 7 days. Only whoever marks attendance opens it.
 */
export default async function ExtraWorkPage() {
  const viewer = await requirePermission("attendance.self");
  const today = todayIST();
  const [balance, credits, notes, noteDays] = await Promise.all([
    getCompBalance(viewer.id),
    listCredits(viewer.id),
    listOwnNotes(viewer.id),
    getNoteDays(today),
  ]);

  return (
    <>
      <CompLeaveCard balance={balance} credits={credits} today={today} />
      <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Extra work <span className="tabular-nums">{notes.length}</span>
        </h2>
        <AddNoteButton days={noteDays} />
      </div>
      <ExtraWorkNotesList notes={notes} />
    </>
  );
}
