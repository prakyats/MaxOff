"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import type { NoteDay } from "../domain/notes";

/**
 * The note dialog's code (a form with two selects) loads when the dialog first opens, not with
 * the page: the strip on My Day and /today carries this button on a day off, and those routes
 * hold a first-load budget (ARCHITECTURE §3.1, `pnpm budget`).
 */
const ExtraWorkNoteDialog = dynamic(
  () => import("./extra-work-note-dialog").then((module) => module.ExtraWorkNoteDialog),
  { ssr: false },
);

/** A button that opens the note dialog, for the Extra work tab, the strip's day off and history rows. */
export function AddNoteButton({
  days,
  initialDate,
  label = "Add note",
  size = "default",
  variant = "secondary",
}: {
  days: NoteDay[];
  initialDate?: string;
  label?: string;
  size?: "default" | "sm";
  variant?: "secondary" | "strong";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} data-slot="add-note">
        {label}
      </Button>
      {open ? (
        <ExtraWorkNoteDialog days={days} initialDate={initialDate} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
