"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { BriefcaseIcon, MoreHorizontalIcon } from "lucide-react";
import { useMemo } from "react";

import { formatDateField } from "@/core/time";
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

/** A client with no deliverables running now (N4). */
const NO_WORK = "Nothing running now";

/** A client's open deliverables by date (PP-admin-10), from `dueByClient`. */
export type ClientDueCell = { late: number; next: string | null };

/** "Thu 22 Oct" (the year only when it is not this year), as every date field reads. */
function dueDate(date: string, today: string): string {
  return formatDateField(date, today);
}

/** The Due cell: "2 late" as a red chip, else "Due Thu 22 Oct", else nothing (PP-admin-10). */
function DueCell({ due, today }: { due: ClientDueCell | undefined; today: string }) {
  if (!due) return <span className="text-muted-foreground">Nothing due</span>;
  if (due.late > 0) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge status="overdue" tone="danger" label={`${due.late} late`} />
        {due.next ? (
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            next {dueDate(due.next, today)}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">{due.next ? `Due ${dueDate(due.next, today)}` : ""}</span>
  );
}

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
  work = null,
  due = {},
  today,
}: {
  /**
   * N4 (UX review 2026-10-21) and PP-clients-1: each client's running deliverables ("3 open ·
   * 9/12 done", by client id; null when none run now), on the Owner's list beside the Admin column
   * and on an Admin's instead of it (always themselves). Never money (invariant 2).
   */
  work?: Readonly<Record<string, string | null>> | null;
  /** PP-admin-10: each client's late count and next date (absent: nothing open and dated). */
  due?: Readonly<Record<string, ClientDueCell>>;
  /** The IST date, for the Due words. */
  today: string;
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
    // The Owner keeps the Admin column (PP-clients-1); an Admin's is always themselves (N4).
    ...(canManage
      ? [
          {
            id: "admin",
            header: "Admin",
            accessorFn: (client: ClientSummary) => adminName(client) ?? "",
            cell: ({ row }: { row: { original: ClientSummary } }) =>
              adminName(row.original) ?? (
                <span className="text-muted-foreground">No Admin yet</span>
              ),
            size: 150,
          } satisfies ColumnDef<ClientSummary>,
        ]
      : []),
    ...(work
      ? [
          {
            id: "work",
            header: "Deliverables",
            accessorFn: (client: ClientSummary) => work[client.id] ?? "",
            cell: ({ row }: { row: { original: ClientSummary } }) =>
              work[row.original.id] ?? <span className="text-muted-foreground">{NO_WORK}</span>,
            size: 170,
          } satisfies ColumnDef<ClientSummary>,
        ]
      : []),
    {
      id: "due",
      header: "Due",
      // Late first, then the soonest date; nothing due last.
      accessorFn: (client) => {
        const entry = due[client.id];
        if (!entry) return "9";
        return entry.late > 0 ? `0${String(999 - entry.late).padStart(3, "0")}` : `1${entry.next}`;
      },
      cell: ({ row }) => <DueCell due={due[row.original.id]} today={today} />,
      size: 170,
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
            <DropdownMenuContent align="end" className="min-w-44" title={client.name}>
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
    // The logo leads the card, beside the title rather than inside it: at large system text the
    // name then drops under the logo with the card's full width instead of being cut to a sliver
    // between the logo and the card's ⋯ and › (§14.2 i, the truncation rule).
    leading: (client) => <ClientLogo fileId={client.logoFileId} name={client.name} />,
    title: (client) => client.name,
    detailTitle: (client) => client.name,
    // The Owner's card: who runs it, then the work; an Admin's: the work (N4, PP-clients-1).
    subtitle: (client) =>
      [canManage ? (adminName(client) ?? "No Admin yet") : null, work?.[client.id] ?? NO_WORK]
        .filter(Boolean)
        .join(" · "),
    trailing: (client) => {
      const late = due[client.id]?.late ?? 0;
      return (
        <span className="inline-flex flex-wrap items-center justify-end gap-2">
          {late > 0 ? <StatusBadge status="overdue" tone="danger" label={`${late} late`} /> : null}
          <StatusDot status={client.state} label={CLIENT_STATE_LABELS[client.state]} />
        </span>
      );
    },
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
