"use client";

import { PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import type { TaskFormSetup } from "./task-form-dialog";

/** The form (selects, the warning check, custom fields) loads when it first opens (§19). */
const TaskFormDialog = dynamic(
  () => import("./task-form-dialog").then((module) => module.TaskFormDialog),
  { ssr: false },
);

const CREATE = { kind: "create" } as const;

/**
 * "New task" for the Owner and Admins (`tasks.create`, 4.3): the Tasks screen's one action, a FAB
 * on a phone through `PageHeader` (§14.1). A trigger that opens a form, so neutral solid (the
 * action colour rule); the commit is inside. `setup` is read only when the form opens.
 */
export function NewTaskButton({ setup }: { setup: Promise<TaskFormSetup | null> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)} data-slot="new-task">
        <PlusIcon aria-hidden />
        New task
      </Button>
      {open ? <TaskFormDialog setup={setup} mode={CREATE} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
