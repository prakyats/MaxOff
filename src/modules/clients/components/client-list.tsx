"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { BriefcaseIcon, MoreHorizontalIcon } from "lucide-react";
import { useMemo } from "react";

import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import type { DataTableFilter } from "@/core/ui/composites/data-table-view";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusBadge, StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import {
  ALL,
  CLIENT_ACTION_LABELS,
  CLIENT_STATE_LABELS,
  CLIENT_STATES,
  clientMenuMoves,
  type ClientSummary,
  matchesAdmin,
  matchesState,
  NO_ADMIN,
} from "../domain/clients";

import { ClientLogo } from "./client-logo";
import { type AdminOption, useClientActions } from "./use-client-actions";

/**
 * The client list (3.4, PRODUCT §4.4, kickoff 3 decision 18): logo, name, state and Admin;
 * cards on a phone, a table from `md` up. Search by name and the state and Admin filters are
 * view controls (the URL keeps them with a replace, §14.2 d). Every list opens on Active, "All
 * states" one tap away (the Owner's by kickoff 3, an Admin's by the 3B review). The Owner's holds
 * the lifecycle and the Admin behind ⋯; an Admin sees their own clients and edits them on the
 * client's page.
 */
export function ClientList({
  clients,
  admins,
  adminNames,
  canManage,
}: {
  clients: ClientSummary[];
  /** Active Admins, for the Owner's Admin filter and "Change Admin". */
  admins: readonly AdminOption[];
  /** Names of every member who may appear as a client's Admin (a former one included). */
  adminNames: Readonly<Record<string, string>>;
  canManage: boolean;
}) {
  const { act, dialogs } = useClientActions(admins);
  const adminName = (client: ClientSummary) =>
    client.adminId ? (adminNames[client.adminId] ?? "An Admin") : null;

  const filters = useMemo<DataTableFilter<ClientSummary>[]>(() => {
    const state: DataTableFilter<ClientSummary> = {
      id: "state",
      label: "State",
      options: [
        { value: ALL, label: "All states" },
        ...CLIENT_STATES.map((value) => ({ value, label: CLIENT_STATE_LABELS[value] })),
      ],
      // The Owner's and an Admin's list both open on Active (owner decisions 2026-09-27).
      defaultValue: "active",
      match: matchesState,
    };
    if (!canManage) return [state];
    return [
      state,
      {
        id: "admin",
        label: "Admin",
        options: [
          { value: ALL, label: "All Admins" },
          ...admins.map((admin) => ({ value: admin.id, label: admin.name })),
          { value: NO_ADMIN, label: "No Admin" },
        ],
        defaultValue: ALL,
        match: matchesAdmin,
      },
    ];
  }, [admins, canManage]);

  const columns: ColumnDef<ClientSummary>[] = [
    {
      accessorKey: "name",
      header: "Client",
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <ClientLogo fileId={row.original.logoFileId} name={row.original.name} />
          <div className="min-w-0">
            <DrillLink
              href={`/clients/${row.original.id}`}
              className="block truncate font-medium underline-offset-4 hover:underline"
            >
              {row.original.name}
            </DrillLink>
            {row.original.city ? (
              <p className="text-muted-foreground truncate text-xs">{row.original.city}</p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "state",
      header: "State",
      cell: ({ row }) => (
        <StatusBadge status={row.original.state} label={CLIENT_STATE_LABELS[row.original.state]} />
      ),
      size: 110,
    },
    {
      id: "admin",
      header: "Admin",
      accessorFn: (client) => adminName(client) ?? "",
      cell: ({ row }) =>
        adminName(row.original) ?? <span className="text-muted-foreground">No Admin yet</span>,
    },
  ];
  if (canManage) {
    columns.push({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      size: 48,
      cell: ({ row }) => {
        const client = row.original;
        const moves = clientMenuMoves(client);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${client.name}`}>
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onSelect={() => act("admin", client)}>
                {client.adminId ? "Change Admin" : "Assign Admin"}
              </DropdownMenuItem>
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
        );
      },
    });
  }

  const mobile: MobileCard<ClientSummary> = {
    title: (client) => (
      <span className="inline-flex max-w-full items-center gap-2 align-middle">
        <ClientLogo fileId={client.logoFileId} name={client.name} />
        <span className="truncate">{client.name}</span>
      </span>
    ),
    detailTitle: (client) => client.name,
    subtitle: (client) => adminName(client) ?? "No Admin yet",
    trailing: (client) => (
      <StatusDot status={client.state} label={CLIENT_STATE_LABELS[client.state]} />
    ),
    href: (client) => `/clients/${client.id}`,
    moreLabel: (client) => `More for ${client.name}`,
    // The sheet behind ⋯ is the Owner's: the facts and the lifecycle. An Admin's card only opens.
    ...(canManage
      ? {
          detail: (client: ClientSummary) => (
            <dl className="flex flex-col gap-3">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">State</dt>
                <dd className="text-right">
                  <StatusBadge status={client.state} label={CLIENT_STATE_LABELS[client.state]} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Admin</dt>
                <dd className="text-right">{adminName(client) ?? "No Admin yet"}</dd>
              </div>
              {client.city ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">City</dt>
                  <dd className="text-right">{client.city}</dd>
                </div>
              ) : null}
            </dl>
          ),
          actions: (client: ClientSummary) => {
            const moves = clientMenuMoves(client);
            return (
              <>
                <Button variant="secondary" onClick={() => act("admin", client)}>
                  {client.adminId ? "Change Admin" : "Assign Admin"}
                </Button>
                {moves
                  .filter((move) => move !== "close")
                  .map((move) => (
                    <Button key={move} variant="secondary" onClick={() => act(move, client)}>
                      {CLIENT_ACTION_LABELS[move]}
                    </Button>
                  ))}
                {moves.includes("close") ? (
                  // Destructive last, with the others between it and the thumb (§14.1).
                  <Button variant="destructive" onClick={() => act("close", client)}>
                    Close
                  </Button>
                ) : null}
              </>
            );
          },
        }
      : {}),
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={clients}
        getRowId={(client) => client.id}
        pageSize={0}
        caption="Clients"
        mobile={mobile}
        search={{
          label: "Search clients",
          placeholder: "Search by name",
          text: (client) => [client.name, client.legalName, client.city].filter(Boolean).join(" "),
        }}
        filters={filters}
        noMatchTitle="No clients match"
        emptyState={
          <EmptyState
            icon={BriefcaseIcon}
            title={canManage ? "No clients yet" : "No clients assigned to you yet"}
            description={
              canManage
                ? "Add the first client; assign an Admin and activate it when work starts."
                : "The Owner assigns clients to Admins. Yours appear here."
            }
          />
        }
      />
      {dialogs}
    </>
  );
}
