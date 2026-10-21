"use client";

import { CheckIcon, PanelRightOpenIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import { ItemRowMenuTrigger } from "./item-row-menu-trigger";

export type ItemRowMenuProps = {
  /** The deliverable's title (the button's label). */
  title: string;
  disabled: boolean;
  className: string;
  onOpen: () => void;
  onMarkDone: () => void;
  /** The stand-in was tapped before this code had arrived: open at once. */
  defaultOpen: boolean;
};

/**
 * A deliverable row's ⋯ menu (Open, Mark done) behind `DeliverableRow`, which loads it after the
 * page (ARCHITECTURE §19): the Radix menu draws nothing until it is opened.
 */
export function ItemRowMenu({
  title,
  disabled,
  className,
  onOpen,
  onMarkDone,
  defaultOpen,
}: ItemRowMenuProps) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <ItemRowMenuTrigger title={title} disabled={disabled} className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" title={title}>
        <DropdownMenuItem data-slot="item-row-menu-open" onSelect={onOpen}>
          <PanelRightOpenIcon aria-hidden />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem data-slot="item-row-menu-done" onSelect={onMarkDone}>
          <CheckIcon aria-hidden />
          Mark done
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
