"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { requestEdit } from "@/core/ui/edit/edit-requests";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import { CLIENT_ACTION_LABELS, clientEditKey, clientMenuMoves } from "../domain/clients";

import { type AdminOption, type ClientRef, useClientActions } from "./use-client-actions";

/**
 * The ⋯ menu in a client's page header (3.4): **Edit details** (the Overview's edit pattern;
 * from Brand or Activity it switches to Overview first with a replace, the tabs being views of
 * one screen, §14.2 d), and for the Owner the Admin and the lifecycle (`clients.manage`). A
 * layer like every menu (§14.2 a). An Admin's menu holds only Edit details.
 */
export function ClientMenu({
  client,
  canManage,
  admins,
}: {
  client: ClientRef;
  canManage: boolean;
  admins: readonly AdminOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { act, dialogs } = useClientActions(admins);
  const overview = `/clients/${client.id}`;
  const moves = canManage ? clientMenuMoves(client) : [];

  function edit() {
    requestEdit(clientEditKey(client.id));
    if (pathname !== overview) {
      closeOverlaysThen(() => router.replace(overview, { scroll: false }));
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${client.name}`}
            data-slot="client-menu"
            className="size-11 md:size-8"
          >
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onSelect={edit}>Edit details</DropdownMenuItem>
          {canManage ? (
            <DropdownMenuItem onSelect={() => act("admin", client)}>
              {client.adminId ? "Change Admin" : "Assign Admin"}
            </DropdownMenuItem>
          ) : null}
          {moves
            .filter((move) => move !== "close")
            .map((move) => (
              <DropdownMenuItem key={move} onSelect={() => act(move, client)}>
                {CLIENT_ACTION_LABELS[move]}
              </DropdownMenuItem>
            ))}
          {moves.includes("close") ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => act("close", client)}>
                Close
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  );
}
