"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/core/lib/utils";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import type { ISODate } from "@/core/time";

import {
  type CalendarQuery,
  type CalendarScope,
  calendarHref,
  filterKinds,
  STATUS_FILTER_LABELS,
  STATUS_FILTERS,
} from "../domain/calendar";

/** The choices a filter offers: an id and its name. */
export type FilterChoice = { id: string; name: string };

const ANY = "any";

/**
 * The calendar's filters (6.4, Kickoff 6 decision 15): client, person, type and status for the
 * Owner and Admins, type only for Crew. A filter is view state: a change replaces the address
 * (`router.replace`), so filtering never adds history and one back leaves the calendar
 * (ARCHITECTURE §14.2 d). Each select is the app's own (a bottom sheet on a phone, §14.1).
 */
export function CalendarFilters({
  query,
  scope,
  today,
  clients,
  people,
  types,
}: {
  query: CalendarQuery;
  scope: CalendarScope;
  today: ISODate;
  clients: readonly FilterChoice[];
  people: readonly FilterChoice[];
  types: readonly FilterChoice[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const kinds = filterKinds(scope);
  const move = (next: CalendarQuery) => {
    startTransition(() => {
      router.replace(calendarHref(next, today), { scroll: false });
    });
  };
  const choice = (
    key: "client" | "person" | "type",
    label: string,
    choices: readonly FilterChoice[],
    any: string,
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`calendar-filter-${key}`} className="text-xs">
        {label}
      </Label>
      <Select
        value={query[key] ?? ANY}
        onValueChange={(value) => move({ ...query, [key]: value === ANY ? null : value })}
      >
        <SelectTrigger
          id={`calendar-filter-${key}`}
          aria-label={label}
          className="w-full"
          data-slot={`calendar-filter-${key}`}
        >
          <SelectValue placeholder={any} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{any}</SelectItem>
          {choices.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div
      data-slot="calendar-filters"
      data-pending={pending ? "" : undefined}
      className={cn(
        "grid gap-3 transition-opacity",
        kinds.length === 1 ? "grid-cols-1 md:w-80" : "grid-cols-2 md:grid-cols-4",
        pending && "opacity-70",
      )}
      aria-busy={pending || undefined}
    >
      {kinds.includes("client") ? choice("client", "Client", clients, "Any client") : null}
      {kinds.includes("person") ? choice("person", "Person", people, "Anyone") : null}
      {kinds.includes("type") ? choice("type", "Type", types, "Any type") : null}
      {kinds.includes("status") ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="calendar-filter-status" className="text-xs">
            Status
          </Label>
          <Select
            value={query.status}
            onValueChange={(value) =>
              move({ ...query, status: value === "open" || value === "done" ? value : "all" })
            }
          >
            <SelectTrigger
              id="calendar-filter-status"
              aria-label="Status"
              className="w-full"
              data-slot="calendar-filter-status"
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
  );
}
