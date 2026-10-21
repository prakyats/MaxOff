"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import type { MenuLayer } from "./project-menu-layers";
import { ProjectMenuTrigger } from "./project-menu-trigger";

export type MenuEntry = { key: MenuLayer; label: string };

export type ProjectMenuDropdownProps = {
  /** The project's name (the button's label). */
  name: string;
  entries: readonly MenuEntry[];
  lifecycle: readonly MenuEntry[];
  onPick: (key: MenuLayer) => void;
  /** "Copy schedule as text"; null: not offered. */
  onCopySchedule: (() => void) | null;
  /** The stand-in was tapped before this code had arrived: open at once. */
  defaultOpen: boolean;
};

/**
 * The project's ⋯ dropdown behind `ProjectMenu`, which loads it after the page (ARCHITECTURE
 * §19): the Radix menu draws nothing until it is opened. Each pick opens its layer in
 * `ProjectMenu`, which holds them.
 */
export function ProjectMenuDropdown({
  name,
  entries,
  lifecycle,
  onPick,
  onCopySchedule,
  defaultOpen,
}: ProjectMenuDropdownProps) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <ProjectMenuTrigger name={name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" title={name}>
        {entries.map((entry) => (
          <DropdownMenuItem key={entry.key} onSelect={() => onPick(entry.key)}>
            {entry.label}
          </DropdownMenuItem>
        ))}
        {onCopySchedule !== null ? (
          <DropdownMenuItem data-slot="copy-schedule" onSelect={onCopySchedule}>
            Copy schedule as text
          </DropdownMenuItem>
        ) : null}
        {(entries.length > 0 || onCopySchedule !== null) && lifecycle.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {lifecycle.map((entry) => (
          <DropdownMenuItem key={entry.key} onSelect={() => onPick(entry.key)}>
            {entry.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
