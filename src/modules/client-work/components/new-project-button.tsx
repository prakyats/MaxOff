"use client";

import { PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import type { NewProjectProps } from "./new-project-dialog";

/** The form (selects, the custom fields) loads when it first opens (ARCHITECTURE §19). */
const NewProjectDialog = dynamic(
  () => import("./new-project-dialog").then((module) => module.NewProjectDialog),
  { ssr: false },
);

/**
 * "New project" on a client's Projects tab (7.3, `projects.manage`): a trigger that opens a form,
 * so neutral solid (the action colour rule); the commit is inside. The dialog is mounted while
 * open, so each opening starts from an empty draft.
 */
export function NewProjectButton(props: NewProjectProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" data-slot="new-project" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        New project
      </Button>
      {open ? <NewProjectDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
