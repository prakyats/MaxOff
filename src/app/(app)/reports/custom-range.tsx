"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";
import { DateInput } from "@/core/ui/primitives/date-time-input";
import { Label } from "@/core/ui/primitives/label";

/**
 * The work report's custom range (6.3, PRODUCT §4.13: "week, month or custom range"): two dates
 * and Show. A view control: the address follows with `replace`, so one back leaves the report
 * (ARCHITECTURE §14.2 d). The server clamps the range (`parsePeriod`).
 */
export function CustomRange({
  from,
  to,
  today,
  base = "/reports",
  note = null,
}: {
  from: string;
  to: string;
  today: string;
  /** The report's own address (v3.0). */
  base?: string;
  /** Said under the dates when the range asked for was too long and was cut (`clippedWords`). */
  note?: string | null;
}) {
  const router = useRouter();
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const valid = start !== "" && end !== "" && start <= end;
  return (
    <div className="flex flex-col gap-2">
      <form
        data-slot="custom-range"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) router.replace(`${base}?from=${start}&to=${end}`, { scroll: false });
        }}
      >
        <div className="flex min-w-36 flex-1 flex-col gap-1.5">
          <Label htmlFor="range-from">From</Label>
          <DateInput
            id="range-from"
            value={start}
            max={today}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className="flex min-w-36 flex-1 flex-col gap-1.5">
          <Label htmlFor="range-to">To</Label>
          <DateInput
            id="range-to"
            value={end}
            max={today}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
        {/* pending: none (a view control: it changes what the report shows, saves nothing) */}
        <Button type="submit" variant="secondary" disabled={!valid}>
          Show
        </Button>
      </form>
      {note ? (
        <p className="text-muted-foreground text-sm" role="status" data-slot="range-clipped">
          {note}
        </p>
      ) : null}
    </div>
  );
}
