"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";

import { type ClientHandoverData, getClientHandover } from "../actions/members";

export type HandoverMove = { clientId: string; adminId: string };

function clientCount(count: number): string {
  return count === 1 ? "1 client" : `${count} clients`;
}

/**
 * "Move Ravi's 3 clients to: [Admin ▾]" inside the Owner's demotion or deactivation (phase 3
 * review, owner: no client is ever left without an Admin). One pick for all, or one per client.
 * Reports the moves through `onChange`: `[]` when the person runs no client, `null` while the
 * list loads or any client has no new Admin yet, so the dialog's commit waits.
 */
export function ClientHandover({
  member,
  onChange,
}: {
  member: { id: string; fullName: string };
  onChange: (moves: HandoverMove[] | null) => void;
}) {
  const [data, setData] = useState<ClientHandoverData | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState("");
  const [perClient, setPerClient] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const allId = useId();

  useEffect(() => {
    let live = true;
    void getClientHandover({ memberId: member.id }).then((result) => {
      if (!live) return;
      if (result.ok) setData(result.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [member.id]);

  const moves = useMemo<HandoverMove[] | null>(() => {
    if (!data) return null;
    const chosen = data.clients.map((client) => ({
      clientId: client.id,
      adminId: (perClient ? picks[client.id] : undefined) || all,
    }));
    return chosen.every((move) => move.adminId !== "") ? chosen : null;
  }, [data, perClient, picks, all]);

  // `moves` changes only when a pick does; the parent passes a state setter, so this runs once
  // per real change.
  useEffect(() => {
    onChange(moves);
  }, [moves, onChange]);

  if (failed) {
    return (
      <ErrorText>
        Couldn&apos;t load {member.fullName}&apos;s clients. Close and try again.
      </ErrorText>
    );
  }
  if (!data) {
    return (
      <p
        className="text-muted-foreground flex min-h-11 items-center gap-2 text-sm"
        data-slot="client-handover-loading"
      >
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
        Checking {member.fullName}&apos;s clients…
      </p>
    );
  }
  if (data.clients.length === 0) return null;

  const count = clientCount(data.clients.length);
  if (data.admins.length === 0) {
    return (
      <ErrorText>
        {member.fullName} runs {count} and there is no other active Admin to take{" "}
        {data.clients.length === 1 ? "it" : "them"}. Make someone an Admin first.
      </ErrorText>
    );
  }

  const adminItems = data.admins.map((admin) => (
    <SelectItem key={admin.id} value={admin.id}>
      {admin.name}
    </SelectItem>
  ));

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-slot="client-handover">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={allId}>
          Move {member.fullName}&apos;s {count} to
        </Label>
        <Select value={all} onValueChange={setAll}>
          <SelectTrigger id={allId} className="w-full">
            <SelectValue placeholder="Choose an Admin" />
          </SelectTrigger>
          <SelectContent>{adminItems}</SelectContent>
        </Select>
      </div>
      {data.clients.length > 1 ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => setPerClient((open) => !open)}
          aria-expanded={perClient}
        >
          {perClient ? "One Admin for all" : "Choose per client"}
        </Button>
      ) : null}
      {perClient ? (
        <ul className="flex flex-col gap-2" data-slot="client-handover-list">
          {data.clients.map((client) => (
            <li key={client.id} className="flex flex-col gap-1.5">
              <Label htmlFor={`${allId}-${client.id}`}>{client.name}</Label>
              <Select
                value={picks[client.id] || all}
                onValueChange={(next) => setPicks((current) => ({ ...current, [client.id]: next }))}
              >
                <SelectTrigger id={`${allId}-${client.id}`} className="w-full">
                  <SelectValue placeholder="Choose an Admin" />
                </SelectTrigger>
                <SelectContent>{adminItems}</SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
