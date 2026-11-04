"use client";

import { PauseIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import type { ISODate } from "@/core/time";
import { Button } from "@/core/ui/primitives/button";

import type { ResumeRow } from "../domain/hold";
import type { Recurrence } from "../domain/types";

/** The resume sheet's code loads after the page, on the first tap (ARCHITECTURE §19). */
const ProjectResumeSheet = dynamic(
  () => import("./project-resume-sheet").then((module) => module.ProjectResumeSheet),
  { ssr: false },
);

export type ProjectResumeProps = {
  projectId: string;
  projectName: string;
  rows: readonly ResumeRow[];
  today: ISODate;
  recurrence: Recurrence;
  deliveryDate: ISODate | null;
};

/**
 * A held project's banner (v1.9 W8; the approved sample §2): amber, under the title, "On hold
 * since 20 Oct · "Client paused content for Diwali week"", and **Resume…** for the Owner and the
 * client's Admin, which opens the resume sheet (every passed date and ended month in one go).
 * Everyone else on the page reads why ticks and Mark done wait.
 */
export function ProjectHoldBanner({
  since,
  reason,
  resume,
}: {
  /** "On hold since 20 Oct". */
  since: string;
  reason: string | null;
  /** Null: the viewer may not resume (the line says who can). */
  resume: ProjectResumeProps | null;
}) {
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  return (
    <div
      role="status"
      data-slot="project-hold-banner"
      className="border-border bg-attention-soft flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm md:flex-row md:items-center md:gap-3 md:py-2"
    >
      <p className="flex min-w-0 flex-1 items-start gap-2 break-words">
        <PauseIcon aria-hidden className="text-attention mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">
          <span className="text-attention font-semibold" data-slot="project-hold-since">
            {since}
          </span>
          {reason ? (
            <>
              <span className="max-md:hidden"> · </span>
              <span className="block md:inline" data-slot="project-hold-reason">
                &ldquo;{reason}&rdquo;
              </span>
            </>
          ) : null}
          <span className="text-muted-foreground block text-xs">
            No new cycles, reminders or escalations; ticks and Mark done wait for the resume.
          </span>
        </span>
      </p>
      {resume ? (
        // pending: none — it opens the resume sheet, whose own button commits.
        <Button
          type="button"
          variant="primary"
          opens
          className="min-h-11 w-full md:min-h-8 md:w-auto md:shrink-0"
          data-slot="project-resume"
          onClick={() => {
            setUsed(true);
            setOpen(true);
          }}
        >
          Resume…
        </Button>
      ) : null}
      {resume && used ? (
        <ProjectResumeSheet open={open} onOpenChange={setOpen} {...resume} />
      ) : null}
    </div>
  );
}
