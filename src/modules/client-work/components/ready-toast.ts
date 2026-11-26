"use client";

import { toast } from "sonner";

import type { ReadyProject } from "../domain/projects";

/** Long enough to read and reach: it is the only word that the project can now be completed. */
const READY_MS = 10_000;

/**
 * "Nothing silently missed" (v2.1, kickoff 9 R1): a Mark done that left a one-time project with
 * every deliverable done, without completing it ("Mark done only", Today, a bulk tick), says so,
 * with the way to complete it. Shown after the mark has been sent (so after its Undo window), to
 * whoever may complete the project (the server answers a project only for them). Never an amount.
 */
export function toastReadyToComplete(project: ReadyProject, onComplete: () => void): void {
  toast("All deliverables done", {
    id: `project-ready-${project.id}`,
    description: `${project.name} is ready to complete.`,
    duration: READY_MS,
    action: { label: "Complete project", onClick: onComplete },
  });
}
