"use client";

import { useRef, useState } from "react";

import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";

import {
  type CalendarQuery,
  type CalendarScope,
  filterCount,
  filterKinds,
  STATUS_FILTER_LABELS,
  STATUS_FILTERS,
} from "../domain/calendar";

/** The choices a filter offers: an id and its name. */
export type FilterChoice = { id: string; name: string };

export type FilterChoices = {
  clients: readonly FilterChoice[];
  people: readonly FilterChoice[];
  types: readonly FilterChoice[];
};

const ANY = "any";

/**
 * The calendar's filters (6.4b; Kickoff 6 decision 25 F): one "Filters" button opens this sheet
 * (a bottom sheet on a phone, a dialog from `md` up): client, person, type and status for the
 * Owner and Admins, type only for Crew (decision 15). The choices apply when the sheet closes
 * (Done, back, a tap outside): view state, so the caller replaces the address once the sheet's
 * own history entry is backed out, never pushes (ARCHITECTURE §14.2 d). Each select is the app's own (its own sheet on a phone); a trigger keeps
 * its `data-slot` (the phone's 44px and 16px rules) and is found by `data-field`. Loaded after the
 * page, on its first opening (§19).
 */
export function FiltersSheet({
  query: initial,
  scope,
  choices,
  onClose,
}: {
  query: CalendarQuery;
  scope: CalendarScope;
  choices: FilterChoices;
  /** Closed, with the filters as chosen (the caller applies them when they changed). */
  onClose: (next: CalendarQuery) => void;
}) {
  const [query, setQuery] = useState(initial);
  const onChange = setQuery;
  // Closed once: Done unmounts the sheet, and a back that lands while it is still mounted
  // closes it through the dialog as well; the caller applies the filters one time.
  const closed = useRef(false);
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    onClose(query);
  };
  const kinds = filterKinds(scope);
  const count = filterCount(query);
  const pick = (
    key: "client" | "person" | "type",
    label: string,
    options: readonly FilterChoice[],
    any: string,
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`calendar-filter-${key}`}>{label}</Label>
      <Select
        value={query[key] ?? ANY}
        onValueChange={(value) => onChange({ ...query, [key]: value === ANY ? null : value })}
      >
        <SelectTrigger
          id={`calendar-filter-${key}`}
          aria-label={label}
          className="w-full"
          data-field={`calendar-filter-${key}`}
        >
          <SelectValue placeholder={any} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{any}</SelectItem>
          {options.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {/* One column no wider than the sheet: the surface is a grid, and a select's one-line
          trigger would otherwise widen its column at large text, pushing the footer past the
          screen's edge. */}
      <DialogContent data-calendar="filters-sheet" className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Filters</DialogTitle>
          <DialogDescription>
            {count > 0 ? `${count} on. ` : ""}What the calendar shows. Applied when you close this.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          {kinds.includes("client")
            ? pick("client", "Client", choices.clients, "Any client")
            : null}
          {kinds.includes("person") ? pick("person", "Person", choices.people, "Anyone") : null}
          {kinds.includes("type") ? pick("type", "Type", choices.types, "Any type") : null}
          {kinds.includes("status") ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="calendar-filter-status">Status</Label>
              <Select
                value={query.status}
                onValueChange={(value) =>
                  onChange({
                    ...query,
                    status: value === "open" || value === "done" ? value : "all",
                  })
                }
              >
                <SelectTrigger
                  id="calendar-filter-status"
                  aria-label="Status"
                  className="w-full"
                  data-field="calendar-filter-status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTERS.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_FILTER_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {count > 0 ? (
            <Button
              type="button"
              variant="secondary"
              data-slot="calendar-filters-clear"
              onClick={() =>
                onChange({ ...query, client: null, person: null, type: null, status: "all" })
              }
            >
              Clear filters
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            data-slot="calendar-filters-done"
            onClick={close}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
