"use client";

import { type ColumnDef, type RowSelectionState } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";

import { fail, ok } from "@/core/errors";
import { BulkBar } from "@/core/ui/composites/bulk-bar";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { DataTable, selectionColumn } from "@/core/ui/composites/data-table";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

type SampleTask = {
  id: string;
  title: string;
  owner: string;
  state: string;
  priority: string;
};

// Sample rows for the gallery only. No client or money data, just shapes.
const SAMPLE: SampleTask[] = [
  {
    id: "t1",
    title: "Edit reel: launch teaser",
    owner: "Ananya",
    state: "in_progress",
    priority: "high",
  },
  {
    id: "t2",
    title: "Thumbnail set for October",
    owner: "Rohan",
    state: "submitted",
    priority: "medium",
  },
  {
    id: "t3",
    title: "Colour grade: site visit",
    owner: "Meera",
    state: "changes_requested",
    priority: "urgent",
  },
  { id: "t4", title: "Shoot: product stills", owner: "Ananya", state: "todo", priority: "low" },
  { id: "t5", title: "Caption pack", owner: "Rohan", state: "admin_approved", priority: "medium" },
  { id: "t6", title: "Monthly recap cut", owner: "Meera", state: "completed", priority: "medium" },
];

const COLUMNS: ColumnDef<SampleTask>[] = [
  selectionColumn<SampleTask>(),
  { accessorKey: "title", header: "Task" },
  { accessorKey: "owner", header: "Owner" },
  {
    accessorKey: "state",
    header: "State",
    cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
  },
];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function GalleryInteractive() {
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const selectedCount = Object.keys(selection).length;

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          Data table, selection and bulk bar
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setLoading((v) => !v)}>
            {loading ? "Show rows" : "Show loading rows"}
          </Button>
        </div>
        <DataTable
          caption="Sample tasks"
          columns={COLUMNS}
          data={SAMPLE}
          getRowId={(row) => row.id}
          isLoading={loading}
          pageSize={4}
          rowSelection={selection}
          onRowSelectionChange={setSelection}
        />
        <BulkBar count={selectedCount} onClear={() => setSelection({})} noun="tasks selected">
          <Button size="sm" onClick={() => setConfirmOpen(true)}>
            Approve
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setReasonOpen(true)}>
            Reject
          </Button>
        </BulkBar>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          Dialogs and toasts
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>
            Confirm dialog
          </Button>
          <Button variant="outline" onClick={() => setReasonOpen(true)}>
            Reason dialog
          </Button>
          <Button
            variant="outline"
            onClick={() => toastResult(ok(null), { success: "Task approved" })}
          >
            Success toast
          </Button>
          <Button
            variant="outline"
            onClick={() => toastResult(fail("INVALID_STATE", "This task is already completed"))}
          >
            Error toast with reason
          </Button>
          <Button variant="outline" onClick={() => toastResult(fail("FORBIDDEN"))}>
            Error toast, default message
          </Button>
          <Button variant="outline" onClick={() => toast.info("Cycle generated for 3 clients")}>
            Info toast
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={selectedCount > 0 ? `Approve ${selectedCount} tasks?` : "Approve this task?"}
        description="The CEO's approval completes the task. This is recorded in the history."
        confirmLabel="Approve"
        onConfirm={async () => {
          await wait(600);
          setSelection({});
          toast.success("Approved");
        }}
      />
      <ReasonDialog
        open={reasonOpen}
        onOpenChange={setReasonOpen}
        title={selectedCount > 0 ? `Reject ${selectedCount} tasks` : "Reject this task"}
        description="The assignees see this reason and the task goes back to them."
        submitLabel="Reject"
        destructive
        onSubmit={async (reason) => {
          await wait(600);
          setSelection({});
          toast.success("Rejected", { description: reason });
        }}
      />
    </>
  );
}
