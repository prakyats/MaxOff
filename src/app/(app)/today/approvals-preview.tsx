"use client";

import dynamic from "next/dynamic";
import { type ComponentProps, Suspense } from "react";

/**
 * The Owner's approvals preview on Today (6.2, Kickoff 6 decision 5): the Approvals groups' own
 * components (Approve with the 6-second Undo, Review and its sheet), drawn since the Today refresh
 * (owner 2026-10-09) as compact rows in Today's one list (`preview`), each **in its own chunk**
 * (the first-load budget, 6.0: nothing new on Today's first load). They still render on the
 * server, so the rows are in the first paint and nothing moves; each sits in its own Suspense
 * boundary, so its chunk holds only its own hydration (ARCHITECTURE §19, `me-lazy.tsx`).
 */
const DaysChunk = dynamic(() =>
  import("@/modules/attendance/components/pending-days-group").then(
    (module) => module.PendingDaysGroup,
  ),
);
const LeaveChunk = dynamic(() =>
  import("@/modules/leave/components/pending-leave-group").then(
    (module) => module.PendingLeaveGroup,
  ),
);
const NotesChunk = dynamic(() =>
  import("@/modules/attendance/components/pending-notes-group").then(
    (module) => module.PendingNotesGroup,
  ),
);
const ClaimsChunk = dynamic(() =>
  import("@/modules/expenses/components/pending-claims-group").then(
    (module) => module.PendingClaimsGroup,
  ),
);
const TasksChunk = dynamic(() =>
  import("@/modules/tasks/components/task-approval-group").then(
    (module) => module.TaskApprovalGroup,
  ),
);

export function PreviewDays(props: ComponentProps<typeof DaysChunk>) {
  return (
    <Suspense>
      <DaysChunk {...props} />
    </Suspense>
  );
}

export function PreviewLeave(props: ComponentProps<typeof LeaveChunk>) {
  return (
    <Suspense>
      <LeaveChunk {...props} />
    </Suspense>
  );
}

export function PreviewNotes(props: ComponentProps<typeof NotesChunk>) {
  return (
    <Suspense>
      <NotesChunk {...props} />
    </Suspense>
  );
}

export function PreviewClaims(props: ComponentProps<typeof ClaimsChunk>) {
  return (
    <Suspense>
      <ClaimsChunk {...props} />
    </Suspense>
  );
}

export function PreviewTasks(props: ComponentProps<typeof TasksChunk>) {
  return (
    <Suspense>
      <TasksChunk {...props} />
    </Suspense>
  );
}
