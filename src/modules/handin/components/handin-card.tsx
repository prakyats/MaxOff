"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { postInBackground } from "@/core/http/background";
import { ConfirmDialogLazy } from "@/core/ui/composites/confirm-dialog-lazy";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { leaveOutFile } from "../actions/handin";

/**
 * v5.0 hand-in, the card's small client parts. The card itself is server-rendered on the task
 * page (`app/(app)/tasks/[id]/handin-view.tsx`), so its markup costs no first-load JavaScript
 * (`/tasks/[id]`'s budget is never raised). Here: a file's Leave out with its confirm (a layer:
 * back closes it), and the "Removed in Drive" check a reviewer's card asks once it is on screen.
 * The add area is `HandinAdderLazy` (`handin-lazy.tsx`).
 */

export function HandinLeaveOut({
  fileId,
  name,
  onBehalfOf,
}: {
  fileId: string;
  name: string;
  onBehalfOf: string | null;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirm(true)}
        aria-label={`Leave out ${name}`}
        data-slot="handin-leave-out"
      >
        Leave out
      </Button>
      <ConfirmDialogLazy
        open={confirm}
        onOpenChange={setConfirm}
        title={`Leave out ${name}?`}
        description="It won't be part of this version and isn't counted. It stays in the studio's Drive folder, because MaxOff never deletes files. Someone with the studio Drive can delete it there."
        confirmLabel="Leave it out"
        pendingLabel="Leaving it out…"
        cancelLabel="Keep it"
        onConfirm={async () => {
          const result = await leaveOutFile({ fileId, onBehalfOf });
          toastResult(result, { success: `${name} left out` });
          if (result.ok) router.refresh();
          return result.ok;
        }}
      />
    </>
  );
}

/**
 * "Removed in Drive": asked once the reviewer's card is on screen, never on the page's first
 * render (WORKFLOWS §5C); the page re-reads only when Google answered for some file.
 */
export function HandinDriveCheck({ taskId }: { taskId: string }) {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    void postInBackground<{ checked: number }>("/api/handin/check", { taskId }).then((result) => {
      if (live && result.ok && result.data.checked > 0) router.refresh();
    });
    return () => {
      live = false;
    };
  }, [taskId, router]);
  return null;
}
