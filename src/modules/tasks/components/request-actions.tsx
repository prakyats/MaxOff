"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { declineRequest, withdrawRequest } from "../actions/requests";
import type { RequestActions as Allowed } from "../domain/requests";
import type { ConvertedRequest, TaskFormSetup } from "./task-form-dialog";

/** The form loads when it first opens (§19), as "New task" does. */
const TaskFormDialog = dynamic(
  () => import("./task-form-dialog").then((module) => module.TaskFormDialog),
  { ssr: false },
);

/**
 * A waiting suggestion's controls (4.6; WORKFLOWS §3.4): **Make it a task** opens the create
 * form started from it (`task_request_convert`: the task and the conversion in one transaction),
 * **Decline…** asks the reason the suggester reads, **Withdraw** is the suggester's own while it
 * waits: both red outlines until confirmed (the action colour rule). Each is a layer (§14.2 a).
 * The functions decide again.
 */
export function RequestActions({
  request,
  allowed,
  setup,
}: {
  request: ConvertedRequest;
  allowed: Allowed;
  /** The create form's setup, for those who decide (null for everyone else). */
  setup: Promise<TaskFormSetup | null> | null;
}) {
  const [layer, setLayer] = useState<"none" | "convert" | "decline" | "withdraw">("none");
  const close = () => setLayer("none");

  return (
    <div className="flex flex-wrap gap-2" data-slot="request-actions">
      {allowed.convert && setup ? (
        <Button type="button" variant="strong" onClick={() => setLayer("convert")}>
          Make it a task
        </Button>
      ) : null}
      {allowed.decline ? (
        <Button type="button" variant="destructive" onClick={() => setLayer("decline")}>
          Decline…
        </Button>
      ) : null}
      {allowed.withdraw ? (
        <Button type="button" variant="destructive" onClick={() => setLayer("withdraw")}>
          Withdraw
        </Button>
      ) : null}

      {layer === "convert" && setup ? (
        <TaskFormDialog setup={setup} mode={{ kind: "convert", request }} onClose={close} />
      ) : null}
      <ReasonDialog
        open={layer === "decline"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={`Decline “${request.title}”?`}
        description="Whoever suggested it reads your reason."
        label="Why not"
        placeholder="Explain briefly. The suggester sees this."
        submitLabel="Decline suggestion"
        pendingLabel="Declining…"
        onSubmit={async (reason) => {
          // false keeps the dialog open with the reason; otherwise it closes itself.
          const result = await declineRequest({ requestId: request.id, reason });
          return toastResult(result, { success: "Suggestion declined" });
        }}
      />
      <ConfirmDialog
        open={layer === "withdraw"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title="Withdraw your suggestion?"
        description="It leaves the list of suggestions to decide. You can suggest it again later."
        confirmLabel="Withdraw suggestion"
        pendingLabel="Withdrawing…"
        onConfirm={async () => {
          const result = await withdrawRequest({ requestId: request.id });
          return toastResult(result, { success: "Suggestion withdrawn" });
        }}
      />
    </div>
  );
}
