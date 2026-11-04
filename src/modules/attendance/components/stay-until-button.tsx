"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";
import { Button } from "@/core/ui/primitives/button";

import type { StayUntilSheet, StayUntilTarget } from "./stay-until-sheet";

const loadSheet = () => import("./stay-until-sheet").then((module) => module.StayUntilSheet);

/**
 * The ⋯ behind a person's row on the Owner's board (v1.9 W4, the working-hours sample §3): its one
 * action, **Stay until**, opens the sheet straight away (a menu of one would be a layer for
 * nothing). The sheet loads after the page (ARCHITECTURE §19).
 */
export function StayUntilButton({ target }: { target: StayUntilTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Stay until for ${target.name}`}
        data-slot="stay-until-open"
        className="size-11 shrink-0"
        onClick={() => setOpen(true)}
      >
        <MoreHorizontalIcon aria-hidden />
      </Button>
      <AfterPage<React.ComponentProps<typeof StayUntilSheet>>
        load={loadSheet}
        props={{ target: open ? target : null, onOpenChange: setOpen }}
      />
    </>
  );
}
