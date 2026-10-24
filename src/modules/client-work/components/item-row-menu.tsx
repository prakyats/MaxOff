"use client";

import { CheckIcon, PanelRightOpenIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import { untickedWords } from "../domain/deliverable";

import { ItemRowMenuTrigger } from "./item-row-menu-trigger";

export type ItemRowMenuProps = {
  /** The deliverable's title (the button's label). */
  title: string;
  disabled: boolean;
  className: string;
  onOpen: () => void;
  onMarkDone: () => void;
  /**
   * Stages not ticked yet (PP-sheet-2): above 0, "Mark done…" asks first, naming what is left
   * ("1 stage isn't ticked"); Mark done itself counts every stage as delivered.
   */
  unticked: number;
  /** The stand-in was tapped before this code had arrived: open at once. */
  defaultOpen: boolean;
};

/**
 * A deliverable row's ⋯ menu (Open, Mark done) behind `DeliverableRow`, which loads it after the
 * page (ARCHITECTURE §19): the Radix menu draws nothing until it is opened. Before every stage is
 * ticked its Mark done asks first (PP-sheet-2), as the sheet's does.
 */
export function ItemRowMenu({
  title,
  disabled,
  className,
  onOpen,
  onMarkDone,
  unticked,
  defaultOpen,
}: ItemRowMenuProps) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger asChild>
          <ItemRowMenuTrigger title={title} disabled={disabled} className={className} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" title={title}>
          <DropdownMenuItem data-slot="item-row-menu-open" onSelect={onOpen}>
            <PanelRightOpenIcon aria-hidden />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem
            data-slot="item-row-menu-done"
            onSelect={unticked > 0 ? () => setAsking(true) : onMarkDone}
          >
            <CheckIcon aria-hidden />
            {unticked > 0 ? "Mark done…" : "Mark done"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        approve
        open={asking}
        onOpenChange={setAsking}
        title={`Mark ${title} done?`}
        description={`${untickedWords(unticked)} Mark done counts every stage as delivered.`}
        confirmLabel="Mark done"
        cancelLabel="Keep it open"
        onConfirm={() => {
          setAsking(false);
          onMarkDone();
        }}
      />
    </>
  );
}
