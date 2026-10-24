"use client";

import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { Input } from "@/core/ui/primitives/input";

import { DragHandle, ReorderItem, ReorderList, ReorderMenuItems } from "./reorder";
import { moveItem } from "./reorder-math";
import { useReorder } from "./use-reorder";

/**
 * A plain list of names typed in a form (a task's or a task template's stages, a stage preset's;
 * ROADMAP 6b.18), each row a 44 px drag handle, the name and a ⋯ menu with Move up / Move down
 * (the keyboard and screen-reader way, WCAG 2.5.7) and Remove. The order lives in the form until
 * it is saved. Adding a row stays the caller's ("Add stage" under the list).
 */
export function ReorderNameList({
  names,
  onChange,
  label,
  itemLabel,
  removeLabel,
  namePrefix,
  maxLength,
  disabled = false,
  slot,
}: {
  names: readonly string[];
  onChange: (next: string[]) => void;
  /** The list's accessible name ("Stages"). */
  label: string;
  /** A row's input name for assistive tech ("Stage 2"). */
  itemLabel: (index: number) => string;
  /** The menu's remove entry ("Remove stage"). */
  removeLabel: string;
  /** The inputs' `name`, numbered (`stage` → `stage-0`, `stage-1`, …). */
  namePrefix: string;
  maxLength: number;
  disabled?: boolean;
  /** The rows' `data-slot`. */
  slot?: string;
}) {
  const reorder = useReorder({
    count: names.length,
    labelOf: (index) => names[index]?.trim() || itemLabel(index),
    onMove: (from, to) => onChange(moveItem(names, from, to)),
    disabled,
  });
  if (names.length === 0) return null;
  return (
    <ReorderList reorder={reorder} label={label} className="gap-1">
      {names.map((name, index) => (
        <ReorderItem
          key={index}
          reorder={reorder}
          index={index}
          data-slot={slot}
          className="flex min-w-0 items-center gap-1"
        >
          <DragHandle reorder={reorder} index={index} />
          <Input
            name={`${namePrefix}-${index}`}
            aria-label={itemLabel(index)}
            value={name}
            maxLength={maxLength}
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value;
              onChange(names.map((current, at) => (at === index ? value : current)));
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                disabled={disabled}
                aria-label={`Actions for ${name.trim() || itemLabel(index)}`}
                data-slot="name-list-menu"
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-48"
              title={name.trim() || itemLabel(index)}
            >
              <ReorderMenuItems reorder={reorder} index={index} />
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onChange(names.filter((_, at) => at !== index))}>
                <Trash2Icon aria-hidden />
                {removeLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ReorderItem>
      ))}
    </ReorderList>
  );
}
