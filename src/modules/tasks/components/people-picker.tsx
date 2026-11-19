"use client";

import { SearchIcon } from "lucide-react";
import { type Ref, useId, useMemo, useState } from "react";

import { cn } from "@/core/lib/utils";
import { PersonAvatar } from "@/core/ui/composites/person-avatar";
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
  PICKER_CHIP_LABELS,
  pickerCount,
  type PickerList,
  type PickerRow,
  searchPicker,
} from "../domain/people-picker";

/** What a row shows beside the picker's own words: the photo and "Freelancer · with Ravi". */
export type PickerFace = { avatarFileId: string | null; meta: string };

/** Their day: being read, read, or not readable (people are picked all the same). */
export type PickerCheck = "idle" | "checking" | "ready" | "failed";

/**
 * "Who's on it?" (v6.0 "Admin calendar", the owner-approved samples): the people, each with a
 * checkbox, their name and what their day holds at the task's time (`domain/people-picker.ts`).
 * An event's list is two groups, **Free then** and **Busy then** (a clash says the type, the
 * time and who booked it, with a "Clashes" chip; a full day of leave an "On leave" chip); a
 * deadline's is one list. It follows the date and time live: the form hands it a new list.
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
  const row = (person: PickerRow, group: "free" | "busy" | "day") => (
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
        className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-1"
      >
        {pickerCount(found) === 0 ? (
          <p
            className="text-muted-foreground px-1 py-6 text-center text-sm"
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
          </>
        ) : (
          <ul className="flex flex-col" data-slot="picker-day">
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
        className="text-muted-foreground px-1 pt-2 pb-1 text-xs font-medium tracking-wide uppercase"
      >
        {title}
        {/* The count beside the heading is the laptop's, as the sample. */}
        <span className="max-md:sr-only"> · {count}</span>
      </h3>
      {count === 0 ? (
        <p className="text-muted-foreground px-1 pb-1 text-sm">Nobody</p>
      ) : (
        <ul className="flex flex-col">{children}</ul>
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
  group: "free" | "busy" | "day";
  face: PickerFace | undefined;
  checked: boolean;
  checking: boolean;
  onToggle: (memberId: string, on: boolean) => void;
}) {
  return (
    <li data-slot="picker-row" data-member={row.memberId} data-group={group}>
      <label className="pressable-row flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5">
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onToggle(row.memberId, value === true)}
          className="size-5"
        />
        <PersonAvatar
          person={{ id: row.memberId, name: row.name, avatarFileId: face?.avatarFileId ?? null }}
          size={20}
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
                className="text-muted-foreground text-xs break-words"
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
 * says who is chosen and holds the sheet's one solid action, Done, which only closes it: every
 * tick is already in the form. It ends where the keyboard begins (`Sheet`, §14.1).
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
        className="rounded-t-sheet h-[85dvh] max-h-[85dvh] gap-0"
      >
        <div aria-hidden className={MODAL_HANDLE} />
        <SheetHeader className="shrink-0 pt-5 pr-14 pb-2">
          <SheetTitle>Who&apos;s on it?</SheetTitle>
          <SheetDescription data-slot="people-subtitle">{subtitle}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col px-4">{children}</div>
        <div className="bg-popover flex shrink-0 items-center gap-3 border-t p-4 pb-[calc(1rem+var(--app-safe-bottom))]">
          <p
            className="min-w-0 flex-1 truncate text-sm"
            data-slot="people-chosen"
            aria-live="polite"
          >
            {chosenWords}
          </p>
          <Button type="button" variant="primary" className="h-11 px-5" onClick={onClose}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
