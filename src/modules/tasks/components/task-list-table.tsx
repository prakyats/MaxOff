"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ListChecksIcon } from "lucide-react";
import { useMemo } from "react";

import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import type { DataTableFilter, DataTableFilterOption } from "@/core/ui/composites/data-table-view";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusDot } from "@/core/ui/composites/status-badge";

import {
  ALL,
  FILTER_DEFAULT_LABELS,
  type FilterableTask,
  matchesClient,
  matchesEngagement,
  matchesOverdue,
  matchesPerson,
  matchesState,
  matchesType,
  NO_CLIENT,
  STATE_FILTER_LABELS,
  STATE_FILTERS,
} from "../domain/list-filters";

import { UnreadMarker } from "./unread-marker";

/** One task as the full list shows it: worked out on the server (names, labels, overdue). */
export type TaskListItem = FilterableTask & {
  id: string;
  title: string;
  stateLabel: string;
  /** "Due Thu 1 Oct, 6:00 PM". */
  dueLabel: string;
  dueAt: string;
  /** The primary owner, "Asha (freelancer)" for a freelancer; "You" for the viewer. */
  owner: string;
  clientName: string | null;
  typeName: string;
  /** The viewer's unread comments on it (Kickoff 4 decision 28). */
  unread: number;
};

export type TaskListOptions = {
  people: DataTableFilterOption[];
  clients: DataTableFilterOption[];
  types: DataTableFilterOption[];
  /** The Owner and Admins filter by person and engagement; Staff see their own tasks only. */
  team: boolean;
};

/**
 * The full task list (4.5; Kickoff 4 decisions 17, 18), one tap deeper than the Tasks tab: a table
 * from `md` up, cards on a phone (§14.1), each row opening the task (a drill-down). Search by
 * title; the filters are view controls that keep the URL in step with a replace (§14.2 d):
 * state (Open by default), overdue, and for the Owner and Admins person, client, type and
 * engagement (a freelancer on it, or an employee).
 */
export function TaskListTable({
  tasks,
  options,
}: {
  tasks: TaskListItem[];
  options: TaskListOptions;
}) {
  const filters = useMemo<DataTableFilter<TaskListItem>[]>(() => {
    const state: DataTableFilter<TaskListItem> = {
      id: "state",
      label: "State",
      options: [
        { value: ALL, label: STATE_FILTER_LABELS.all },
        ...STATE_FILTERS.filter((value) => value !== ALL).map((value) => ({
          value,
          label: STATE_FILTER_LABELS[value],
        })),
      ],
      defaultValue: "open",
      match: matchesState,
    };
    const overdue: DataTableFilter<TaskListItem> = {
      id: "overdue",
      label: "Deadline",
      options: [
        { value: ALL, label: FILTER_DEFAULT_LABELS.overdue },
        { value: "overdue", label: "Overdue" },
        { value: "today", label: "Due today" },
      ],
      defaultValue: ALL,
      match: matchesOverdue,
    };
    const client: DataTableFilter<TaskListItem> = {
      id: "client",
      label: "Client",
      options: [
        { value: ALL, label: FILTER_DEFAULT_LABELS.client },
        ...options.clients,
        { value: NO_CLIENT, label: "No client" },
      ],
      defaultValue: ALL,
      match: matchesClient,
    };
    const type: DataTableFilter<TaskListItem> = {
      id: "type",
      label: "Type",
      options: [{ value: ALL, label: FILTER_DEFAULT_LABELS.type }, ...options.types],
      defaultValue: ALL,
      match: matchesType,
    };
    if (!options.team) return [state, overdue, type];
    return [
      state,
      overdue,
      {
        id: "person",
        label: "Person",
        options: [{ value: ALL, label: FILTER_DEFAULT_LABELS.person }, ...options.people],
        defaultValue: ALL,
        match: matchesPerson,
      },
      client,
      type,
      {
        id: "engagement",
        label: "Engagement",
        options: [
          { value: ALL, label: FILTER_DEFAULT_LABELS.engagement },
          { value: "permanent", label: "Employees" },
          { value: "freelance", label: "Freelancers" },
        ],
        defaultValue: ALL,
        match: matchesEngagement,
      },
    ];
  }, [options]);

  const columns: ColumnDef<TaskListItem>[] = [
    {
      accessorKey: "title",
      header: "Task",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <DrillLink
            href={`/tasks/${row.original.id}`}
            className="min-w-0 font-medium break-words underline-offset-4 hover:underline"
          >
            {row.original.title}
          </DrillLink>
          <UnreadMarker count={row.original.unread} />
        </span>
      ),
    },
    {
      accessorKey: "stateLabel",
      header: "State",
      cell: ({ row }) => <TaskState task={row.original} />,
      size: 160,
    },
    {
      accessorKey: "dueAt",
      header: "Deadline",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.dueLabel.replace(/^Due /, "")}
        </span>
      ),
      size: 170,
    },
    { accessorKey: "owner", header: "Primary owner", size: 170 },
    {
      accessorKey: "clientName",
      header: "Client",
      cell: ({ row }) =>
        row.original.clientName ?? <span className="text-muted-foreground">—</span>,
      size: 150,
    },
    { accessorKey: "typeName", header: "Type", size: 130 },
  ];

  // A card's trailing part is one marker (it never wraps beside the title): an overdue task shows
  // "Overdue" there and its state in the second line.
  const mobile: MobileCard<TaskListItem> = {
    // The unread bubble leads the title, so the title's ellipsis never cuts it.
    title: (task) =>
      task.unread > 0 ? (
        <>
          <UnreadMarker count={task.unread} className="mr-1.5 align-middle" />
          {task.title}
        </>
      ) : (
        task.title
      ),
    subtitle: (task) =>
      [task.overdue ? task.stateLabel : null, task.dueLabel, task.owner, task.clientName]
        .filter(Boolean)
        .join(" · "),
    trailing: (task) =>
      task.overdue ? (
        <StatusDot status="overdue" tone="danger" label="Overdue" />
      ) : (
        <StatusDot status={task.state} label={task.stateLabel} />
      ),
    href: (task) => `/tasks/${task.id}`,
  };

  return (
    <DataTable
      columns={columns}
      data={tasks}
      getRowId={(task) => task.id}
      pageSize={50}
      mobilePageSize={20}
      caption="Tasks"
      mobile={mobile}
      search={{ label: "Search tasks", placeholder: "Search by title", text: (task) => task.title }}
      filters={filters}
      noMatchTitle="No tasks match"
      emptyState={
        <EmptyState
          icon={ListChecksIcon}
          title="No tasks yet"
          description={
            options.team
              ? "Tasks you give out, approve or can see appear here."
              : "Tasks given to you appear here."
          }
        />
      }
    />
  );
}

function TaskState({ task }: { task: TaskListItem }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {task.overdue ? <StatusDot status="overdue" tone="danger" label="Overdue" /> : null}
      <StatusDot status={task.state} label={task.stateLabel} />
    </span>
  );
}
