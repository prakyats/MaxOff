"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialogLazy } from "@/core/ui/composites/confirm-dialog-lazy";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { disconnectDrive } from "../actions";

/**
 * Disconnect (v4.0): red outline before its confirmation, the named red commit inside it
 * (ADR-0015). Nothing in Drive is touched; archiving stops until someone connects again.
 */
export function DisconnectDriveButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)} className="w-full sm:w-auto">
        Disconnect
      </Button>
      <ConfirmDialogLazy
        open={open}
        onOpenChange={setOpen}
        destructive
        title="Disconnect Google Drive?"
        description="MaxOff stops archiving new work until a Google account is connected again. Everything already in Drive stays where it is."
        confirmLabel="Disconnect Drive"
        pendingLabel="Disconnecting…"
        onConfirm={async () => {
          const result = await disconnectDrive();
          if (!toastResult(result, { success: "Google Drive is disconnected" })) return false;
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
