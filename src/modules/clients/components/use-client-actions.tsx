"use client";

import { useId, useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { toastResult } from "@/core/ui/toast";

import {
  activateClient,
  assignClientAdmin,
  closeClient,
  pauseClient,
  reactivateClient,
} from "../actions/clients";
import {
  CLIENT_STATE_NOTES,
  type ClientLifecycleAction,
  type ClientState,
} from "../domain/clients";
import { CLIENT_CLOSE_REASON_MAX } from "../domain/limits";

/** What the Owner's client actions need to know about the client. */
export type ClientRef = { id: string; name: string; state: ClientState; adminId: string | null };

export type AdminOption = { id: string; name: string };

type Kind = ClientLifecycleAction | "admin";

const COPY: Record<ClientLifecycleAction, { title: string; description: string; done: string }> = {
  activate: {
    title: "Activate",
    description: "Work can be added to it: projects, items and client-labelled tasks.",
    done: "is active",
  },
  pause: { title: "Pause", description: CLIENT_STATE_NOTES.paused, done: "is paused" },
  close: { title: "Close", description: CLIENT_STATE_NOTES.inactive, done: "is closed" },
  reactivate: {
    title: "Reactivate",
    description: "It becomes Active again, and new work can be added.",
    done: "is active again",
  },
};

/**
 * The Owner's client actions (WORKFLOWS §4, `clients.manage`), shared by the list's ⋯ and the
 * client page's ⋯ (3.4): the lifecycle moves through their transition functions, each behind a
 * confirmation whose red button names it ("Pause Sharma Weddings"), and the Admin assignment,
 * whose button names the person ("Make Ravi the Admin"). A move the state does not allow is never
 * offered (`clientLifecycleActions`); the functions refuse it anyway.
 */
export function useClientActions(admins: readonly AdminOption[]) {
  const [open, setOpen] = useState<{ kind: Kind; client: ClientRef } | null>(null);
  const close = () => setOpen(null);

  const dialogs =
    open === null ? null : open.kind === "admin" ? (
      <AdminDialog key={open.client.id} client={open.client} admins={admins} onClose={close} />
    ) : open.kind === "close" ? (
      <CloseDialog key={open.client.id} client={open.client} onClose={close} />
    ) : (
      <MoveDialog kind={open.kind} client={open.client} onClose={close} />
    );

  return { act: (kind: Kind, client: ClientRef) => setOpen({ kind, client }), dialogs };
}

const MOVES = {
  activate: activateClient,
  pause: pauseClient,
  reactivate: reactivateClient,
} as const;

function MoveDialog({
  kind,
  client,
  onClose,
}: {
  kind: "activate" | "pause" | "reactivate";
  client: ClientRef;
  onClose: () => void;
}) {
  const copy = COPY[kind];
  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`${copy.title} ${client.name}?`}
      description={copy.description}
      confirmLabel={`${copy.title} ${client.name}`}
      onConfirm={async () => {
        const result = await MOVES[kind]({ clientId: client.id });
        toastResult(result, { success: `${client.name} ${copy.done}` });
      }}
    />
  );
}

function CloseDialog({ client, onClose }: { client: ClientRef; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const id = useId();
  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`Close ${client.name}?`}
      description={COPY.close.description}
      confirmLabel={`Close ${client.name}`}
      onConfirm={async () => {
        const result = await closeClient({ clientId: client.id, reason });
        toastResult(result, { success: `${client.name} ${COPY.close.done}` });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Reason (optional)</Label>
        <Textarea
          id={id}
          value={reason}
          maxLength={CLIENT_CLOSE_REASON_MAX}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Recorded in the client's history."
        />
      </div>
    </ConfirmDialog>
  );
}

function AdminDialog({
  client,
  admins,
  onClose,
}: {
  client: ClientRef;
  admins: readonly AdminOption[];
  onClose: () => void;
}) {
  const [adminId, setAdminId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const offered = admins.filter((admin) => admin.id !== client.adminId);
  const chosen = offered.find((admin) => admin.id === adminId);
  const current = admins.find((admin) => admin.id === client.adminId);

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={client.adminId ? `Change ${client.name}'s Admin` : `Assign an Admin to ${client.name}`}
      description={
        current
          ? `${current.name} runs it now. The new Admin sees it at once and ${current.name} no longer does.`
          : "The Admin runs this client: its details, contacts, brand and work."
      }
      confirmLabel={chosen ? `Make ${chosen.name} the Admin` : "Assign Admin"}
      onConfirm={async () => {
        if (!chosen) {
          setProblem("Choose an Admin.");
          return false;
        }
        const result = await assignClientAdmin({ clientId: client.id, adminId: chosen.id });
        toastResult(result, { success: `${chosen.name} runs ${client.name} now` });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Admin</Label>
        {offered.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            There is no other active Admin. Invite one from People first.
          </p>
        ) : (
          <Select
            value={adminId}
            onValueChange={(next) => {
              setAdminId(next);
              setProblem(null);
            }}
          >
            <SelectTrigger id={id} className="w-full" aria-invalid={problem ? true : undefined}>
              <SelectValue placeholder="Choose an Admin" />
            </SelectTrigger>
            <SelectContent>
              {offered.map((admin) => (
                <SelectItem key={admin.id} value={admin.id}>
                  {admin.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {problem ? <ErrorText>{problem}</ErrorText> : null}
      </div>
    </ConfirmDialog>
  );
}
