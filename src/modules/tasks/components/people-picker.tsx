"use client";

import { SearchIcon } from "lucide-react";
import { type Ref, useId, useMemo, useState } from "react";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { Input } from "@/core/ui/primitives/input";
import { MODAL_HANDLE } from "@/core/ui/primitives/modal-surface";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import {
  FREE_LINE,
  PICKER_CHIP_LABELS,
  pickerCount,
  type PickerList,
  type PickerRow,
  searchPicker,
} from "../domain/people-picker";

/** What a row shows beside the picker's own words: the job title or "Freelancer · with Ravi". */
export type PickerFace = { meta: string };

/** Their day: being read, read, or not readable (people are picked all the same). */
export type PickerCheck = "idle" | "checking" | "ready" | "failed";

/**
 * "Who's on it?" (v6.0 "Admin calendar", the owner-approved samples): the people, each with a
 * checkbox, their name and what their day holds at the task's time (`domain/people-picker.ts`).
 * An event's list is two groups, **Free then** and **Busy then** (a clash says the type, the
 * time and who booked it, with a "Clashes" chip; a full day of leave an "On leave" chip), and the
 * Owner, when not busy then, in a small **Owner** group after them (never "Free"); a deadline's
 * is one list. It follows the date and time live: the form hands it a new list.
 *
 * The same list is the phone's sheet (`PeopleSheet`) and the laptop dialog's right-hand column.
 * A tick puts the person on the task at once; nothing here is a commit. Never blocking: someone
 * busy or on leave can be ticked, and the form's warnings record it (WORKFLOWS §3.1).
 */
export function PeoplePicker({
  list,
  chosen,
  faces,
  check,
  onToggle,
  searchRef,
  className,
}: {
  list: PickerList;
  chosen: readonly string[];
  faces: ReadonlyMap<string, PickerFace>;
  check: PickerCheck;
  onToggle: (memberId: string, on: boolean) => void;
  searchRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const found = useMemo(() => searchPicker(list, query), [list, query]);
  const row = (person: PickerRow, group: "free" | "busy" | "owner" | "day") => (
    <PickerRowItem
      key={person.memberId}
      row={person}
      group={group}
      face={faces.get(person.memberId)}
      checked={chosen.includes(person.memberId)}
      checking={check === "checking"}
      onToggle={onToggle}
    />
  );

  return (
    <div data-slot="people-picker" className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative shrink-0">
        <label htmlFor={searchId} className="sr-only">
          Find a person
        </label>
        <SearchIcon
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          id={searchId}
          ref={searchRef}
          type="search"
          placeholder="Find a person"
          autoComplete="off"
          value={query}
          className="pl-8"
          onChange={(event) => setQuery(event.target.value)}
          // Enter here must never send the task: it is a search, not the form's last field.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </div>
      {check === "failed" ? (
        <p className="text-muted-foreground shrink-0 text-xs" data-slot="picker-failed">
          Their day could not be checked. You can still pick people.
        </p>
      ) : null}
      <div
        data-slot="picker-list"
        aria-busy={check === "checking" ? true : undefined}
        className="border-border rounded-card flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border"
      >
        {pickerCount(found) === 0 ? (
          <p
            className="text-muted-foreground px-3 py-6 text-center text-sm"
            data-slot="picker-empty"
          >
            {query.trim() ? `Nobody called “${query.trim()}”.` : "Nobody to assign yet."}
          </p>
        ) : found.kind === "event" ? (
          <>
            <PickerGroup title="Free then" count={found.free.length} slot="picker-free">
              {found.free.map((person) => row(person, "free"))}
            </PickerGroup>
            <PickerGroup title="Busy then" count={found.busy.length} slot="picker-busy">
              {found.busy.map((person) => row(person, "busy"))}
            </PickerGroup>
            {/* The Owner, when not busy then: never under Free then (PERMISSIONS §2). */}
            {found.owner.length > 0 ? (
              <PickerGroup title="Owner" count={found.owner.length} slot="picker-owner">
                {found.owner.map((person) => row(person, "owner"))}
              </PickerGroup>
            ) : null}
          </>
        ) : (
          <ul className="divide-border flex flex-col divide-y" data-slot="picker-day">
            {found.rows.map((person) => row(person, "day"))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PickerGroup({
  title,
  count,
  slot,
  children,
}: {
  title: string;
  count: number;
  slot: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-slot={slot} data-count={count} className="flex flex-col">
      <h3
        id={id}
        className="bg-muted text-muted-foreground border-border sticky top-0 z-10 border-b px-3 py-2 text-xs font-semibold tracking-wide uppercase"
      >
        {title}
        {/* The count beside the heading is the laptop's, as the sample. */}
        <span className="max-md:sr-only"> · {count}</span>
      </h3>
      {count === 0 ? (
        <p className="text-muted-foreground border-border border-b px-3 py-3 text-sm">Nobody</p>
      ) : (
        <ul className="divide-border border-border flex flex-col divide-y border-b">{children}</ul>
      )}
    </section>
  );
}

function PickerRowItem({
  row,
  group,
  face,
  checked,
  checking,
  onToggle,
}: {
  row: PickerRow;
  group: "free" | "busy" | "owner" | "day";
  face: PickerFace | undefined;
  checked: boolean;
  checking: boolean;
  onToggle: (memberId: string, on: boolean) => void;
}) {
  return (
    <li data-slot="picker-row" data-member={row.memberId} data-group={group}>
      <label className="pressable-row has-aria-checked:bg-muted/60 flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2">
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onToggle(row.memberId, value === true)}
          className="size-5"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm break-words">
            <span className="font-medium">{row.name}</span>
            {face?.meta ? <span className="text-muted-foreground"> · {face.meta}</span> : null}
          </span>
          {checking ? (
            <Skeleton className="mt-1 h-3 w-24" />
          ) : (
            row.lines.map((line, index) => (
              <span
                key={`${index}-${line}`}
                data-slot="picker-line"
                className={cn(
                  "text-xs break-words",
                  line === FREE_LINE ? "text-success" : "text-muted-foreground",
                )}
              >
                {line}
              </span>
            ))
          )}
        </span>
        {checking
          ? null
          : row.chips.map((chip) => (
              <span
                key={chip}
                data-slot="picker-chip"
                data-chip={chip}
                className="bg-attention-soft text-attention shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
              >
                {PICKER_CHIP_LABELS[chip]}
              </span>
            ))}
      </label>
    </li>
  );
}

/**
 * The phone's "Who's on it?": a bottom sheet over the form, its own layer (ARCHITECTURE §14.2 a:
 * back closes it and leaves the form and what was typed). The list scrolls inside it, the foot
 * says who is chosen and holds Done, which only closes it (every tick is already in the form), so
 * it is the quiet button every sheet that commits nothing ends with, as the calendar's filters. It ends where the keyboard begins (`Sheet`, §14.1).
 */
export function PeopleSheet({
  open,
  onClose,
  subtitle,
  chosenWords,
  children,
}: {
  open: boolean;
  onClose: () => void;
  subtitle: string;
  chosenWords: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="bottom"
        data-slot="people-sheet"
        // A fixed height (the primitive's own is `h-auto` under the same variant): the list
        // inside is what scrolls, and the sheet does not jump as a search narrows it.
        className="rounded-t-sheet max-h-[85dvh] gap-0 data-[side=bottom]:h-[85dvh]"
      >
        <div aria-hidden className={MODAL_HANDLE} />
        <SheetHeader className="shrink-0 pt-5 pr-14 pb-2">
          <SheetTitle>Who&apos;s on it?</SheetTitle>
          <SheetDescription data-slot="people-subtitle">{subtitle}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col px-4">{children}</div>
        <div className="bg-popover flex shrink-0 flex-col gap-2 border-t p-4 pb-[calc(1rem+var(--app-safe-bottom))]">
          <p
            className="text-muted-foreground min-w-0 truncate text-sm"
            data-slot="people-chosen"
            aria-live="polite"
          >
            {chosenWords}
          </p>
          <Button type="button" variant="secondary" className="h-11 w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
