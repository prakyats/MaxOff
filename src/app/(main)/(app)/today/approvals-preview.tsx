"use client";

import dynamic from "next/dynamic";

/**
 * The Owner's approvals preview on Today (6.2, Kickoff 6 decision 5): the Approvals groups' own
 * components (Approve with the 6-second Undo, Review and its sheet), drawn since the Today refresh
 * (owner 2026-10-09) as compact rows in Today's one list (`preview`), each **in its own chunk**
 * (the first-load budget, 6.0: nothing new on Today's first load). They render on the server.
 * **Each sits in its own Suspense boundary, placed by `owner-today.tsx`** (X5, 2026-11-11): one
 * per chunk keeps a late chunk's wait to its own rows (a tap elsewhere is the app's, never a
 * whole-document load, as `me-lazy.tsx` found), and its fallback, drawn on the server, traces the
 * group's own rows (`ApprovalRowSkeletons`, the server's count): a chunk that suspends the server
 * render streams its rows a moment later, and they replace the skeleton in place, so nothing moves
 * (`loading-screens:790`: the list was empty, then the rows pushed the card down).
 */
export const PreviewDays = dynamic(() =>
  import("@/modules/attendance/components/pending-days-group").then(
    (module) => module.PendingDaysGroup,
  ),
);
export const PreviewLeave = dynamic(() =>
  import("@/modules/leave/components/pending-leave-group").then(
    (module) => module.PendingLeaveGroup,
  ),
);
export const PreviewNotes = dynamic(() =>
  import("@/modules/attendance/components/pending-notes-group").then(
    (module) => module.PendingNotesGroup,
  ),
);
export const PreviewClaims = dynamic(() =>
  import("@/modules/expenses/components/pending-claims-group").then(
    (module) => module.PendingClaimsGroup,
  ),
);
export const PreviewEarly = dynamic(() =>
  import("@/modules/attendance/components/early-leave-group").then(
    (module) => module.EarlyLeavePreviewRows,
  ),
);
export const PreviewTasks = dynamic(() =>
  import("@/modules/tasks/components/task-approval-group").then(
    (module) => module.TaskApprovalGroup,
  ),
);
