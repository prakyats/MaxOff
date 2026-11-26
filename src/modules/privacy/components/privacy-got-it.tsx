"use client";

import { useRouter } from "next/navigation";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { confirmPrivacyNoticeRead } from "../actions/notice";

/**
 * The notice's last row (v7.5 Q1): "Got it" records that the member read this version, and the
 * home screen's card goes. Once read, a quiet line says when instead. The screen's one commit,
 * neutral (ADR-0015).
 */
export function PrivacyGotIt({ readOn }: { readOn: string | null }) {
  const router = useRouter();
  const action = useAction(async () => {
    const result = await confirmPrivacyNoticeRead();
    if (toastResult(result, { success: "Thanks for reading it" })) router.refresh();
  });
  if (readOn) {
    return (
      <p data-slot="privacy-read-on" className="text-muted-foreground text-sm">
        You read this on {readOn}.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <Button
        commits
        pending={action.pending}
        pendingLabel="Saving…"
        data-slot="privacy-got-it"
        onClick={() => action.run()}
      >
        Got it
      </Button>
      <ActionStatus action={action} />
    </div>
  );
}
