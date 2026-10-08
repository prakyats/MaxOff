"use client";

import { ChevronRightIcon, ListChecksIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { Button } from "@/core/ui/primitives/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";

import { ITEM_STATUS } from "../domain/types";
import type { ItemRowView } from "../domain/views";

export type ItemListFilter = "live" | "overdue" | "open" | "done";

const FILTERS: readonly { value: ItemListFilter; label: string }[] = [
  { value: "live", label: "Open and done" },
  { value: "overdue", label: "Overdue" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done, to approve" },
];
const ALL = "all";

type View = { filter: ItemListFilter; client: string; project: string };

function matches(row: ItemRowView, view: View): boolean {
  if (view.client !== ALL && row.clientId !== view.client) return false;
  if (view.project !== ALL && row.projectId !== view.project) return false;
  switch (view.filter) {
    case "overdue":
      return row.planned?.overdue === true;
    case "open":
      return row.state === "open";
    case "done":
      return row.state === "done";
    default:
      return true;
  }
}

function addressOf(view: View): string {
  const params = new URLSearchParams();
  if (view.filter !== "live") params.set("filter", view.filter);
  if (view.client !== ALL) params.set("client", view.client);
  if (view.project !== ALL) params.set("project", view.project);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}

/**
 * The cross-client item list (7.3 / 7.4; PRODUCT §4.7 "Client work on Today", kickoff 7 decision
 * 19, amendment C E1): every open and done item the viewer may see, with the state (`?filter=`:
 * overdue is where the E1 escalation lands), client and project filters as **view controls** (the
 * address is replaced, never pushed: one back leaves the list, §14.2 d). **For the Owner it is
 * grouped by the client's Admin**, his own clients last. A row opens the project on the item's
 * cycle (one tap deeper).
 */
export function ItemList({
  rows,
  grouped,
  adminNames,
  initial,
}: {
  rows: readonly ItemRowView[];
  /** The Owner's view: grouped by Admin. */
  grouped: boolean;
  adminNames: Readonly<Record<string, string>>;
  initial: View;
}) {
  const [view, setView] = useState<View>(initial);
  const latest = useRef<View>(initial);
  const clients = useMemo(
    () =>
      [...new Map(rows.map((row) => [row.clientId, row.clientName])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [rows],
  );
  const projects = useMemo(
    () =>
      [
        ...new Map(
          rows
            .filter((row) => view.client === ALL || row.clientId === view.client)
            .map((row) => [row.projectId, row.projectName]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [rows, view.client],
  );
  const shown = rows.filter((row) => matches(row, view));
  const narrowed = view.filter !== "live" || view.client !== ALL || view.project !== ALL;

  function change(next: Partial<View>) {
    const merged = { ...view, ...next };
    // A project of another client no longer applies.
    if (next.client !== undefined && merged.project !== ALL) {
      const still = rows.some(
        (row) =>
          row.projectId === merged.project &&
          (merged.client === ALL || row.clientId === merged.client),
      );
      if (!still) merged.project = ALL;
    }
    setView(merged);
    latest.current = merged;
    // A filter is chosen inside its open select, whose layer owns the current history entry:
    // that entry is backed out first, so the page's own entry keeps the view (as `DataTable`).
    closeOverlaysThen(() => replaceViewAddress(addressOf(latest.current)));
  }

  const groups: { key: string; name: string | null; rows: ItemRowView[] }[] = grouped
    ? [...new Set(shown.map((row) => row.adminId ?? ""))]
        .map((key) => ({
          key,
          name: key ? (adminNames[key] ?? "An Admin") : "No Admin (yours)",
          rows: shown.filter((row) => (row.adminId ?? "") === key),
        }))
        .sort((a, b) =>
          a.key === "" ? 1 : b.key === "" ? -1 : (a.name ?? "").localeCompare(b.name ?? ""),
        )
    : [{ key: "all", name: null, rows: shown }];

  return (
    <div className="flex flex-col gap-3" data-slot="item-list">
      <div
        data-slot="item-filters"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:flex md:flex-wrap"
      >
        <Select
          value={view.filter}
          onValueChange={(value) => change({ filter: value as ItemListFilter })}
        >
          <SelectTrigger aria-label="State" className="w-full md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={view.client} onValueChange={(value) => change({ client: value })}>
          <SelectTrigger aria-label="Client" className="w-full md:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every client</SelectItem>
            {clients.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={view.project} onValueChange={(value) => change({ project: value })}>
          <SelectTrigger aria-label="Project" className="w-full md:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every project</SelectItem>
            {projects.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title={narrowed ? "Nothing matches." : "No open items."}
          description={
            narrowed
              ? "Nothing here under these filters."
              : "Items of every client's current work show here."
          }
          action={
            narrowed ? (
              <Button
                variant="secondary"
                onClick={() => change({ filter: "live", client: ALL, project: ALL })}
              >
                Show everything
              </Button>
            ) : undefined
          }
        />
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            aria-label={group.name ?? "Items"}
            data-slot="item-group"
            className="flex flex-col gap-1.5"
          >
            {group.name !== null ? (
              <h2 className="text-muted-foreground flex items-baseline justify-between text-xs font-medium">
                <span>{group.name}</span>
                <span className="tabular-nums">{group.rows.length}</span>
              </h2>
            ) : null}
            <ul className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <DrillLink
                    href={row.href}
                    data-slot="item-list-row"
                    className="flex min-h-14 items-center gap-3 px-4 py-2.5"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium break-words">{row.title}</span>
                      <span className="text-muted-foreground text-xs break-words">
                        {row.projectName} · {row.clientName}
                        {row.cycleLabel ? ` · ${row.cycleLabel}` : ""}
                      </span>
                      <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <StatusDot status={ITEM_STATUS[row.state]} />
                          {row.stateLabel}
                        </span>
                        {row.planned ? (
                          <span className={cn(row.planned.overdue && "text-destructive")}>
                            {row.planned.text}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <ChevronRightIcon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                  </DrillLink>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
