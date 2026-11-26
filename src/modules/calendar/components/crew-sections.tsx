import { ROLE_LABELS } from "@/core/lib/role-labels";
import { cn } from "@/core/lib/utils";

import {
  type CrewBusyRow,
  type CrewDay,
  EVERYONE_AVAILABLE,
  everyoneAvailable,
  hasCrew,
  leaveName,
} from "../domain/crew";
import { TypeDot } from "./calendar-chip";

/**
 * The Crew on a day, for the Owner and Admins (v6.0 "Admin calendar"; the approved samples; PERMISSIONS
 * §2 "Availability of others"): who is **Busy** (the person, the task's type with its colour's
 * dot, the time and who booked it, never a title, a client or a location: the data holds none),
 * who is **On leave** and who is **Free**. "Everyone is available" stands alone, and only when
 * nobody is busy or on leave. Three looks of the same facts:
 * - `table`: the day popup's bordered four-column table (name · type · time · booked by);
 * - `card`: the laptop Day's side card, each booking on two lines;
 * - `phone`: the phone's day, "Crew busy · n" as a card of the same two-line rows, then
 *   "On leave · names" and "Free · names".
 * Plain markup, no state: it renders on the server with the day it belongs to.
 */

/** Nobody in a list: said in words, so it is never an empty cell. */
const NOBODY = "Nobody";

/** A booking on two lines: the name and the time, then the type and who booked it. */
function BusyRow({ row }: { row: CrewBusyRow }) {
  return (
    <li
      data-slot="calendar-booking"
      data-member={row.memberId}
      className="flex min-w-0 flex-col gap-0.5 px-4 py-2.5"
    >
      <span className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 font-medium break-words">{row.name}</span>
        <span className="shrink-0 text-xs tabular-nums">{row.when}</span>
      </span>
      <span className="text-muted-foreground flex min-w-0 items-baseline gap-1.5 text-xs">
        <TypeDot color={row.color} className="size-2 shrink-0" />
        <span className="min-w-0 break-words">
          <span className="text-foreground">{row.typeName}</span>
          {row.bookedBy ? ` · ${row.bookedBy}` : ""}
        </span>
      </span>
    </li>
  );
}

/** "On leave" and "Free", each with its names; nobody is said in words. */
function Names({ crew, inline }: { crew: CrewDay; inline: boolean }) {
  const lists = [
    { slot: "calendar-on-leave", label: "On leave", names: crew.onLeave.map(leaveName) },
    { slot: "calendar-free", label: "Free", names: crew.free.map((person) => person.name) },
  ];
  return (
    <dl
      data-slot="calendar-away-free"
      className={cn(
        "text-sm",
        inline ? "flex flex-col gap-2" : "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-y-2",
      )}
    >
      {lists.map((list) => (
        <div key={list.slot} data-slot={list.slot} className={inline ? "min-w-0" : "contents"}>
          <dt className={cn("font-semibold", inline && "inline")}>{list.label}</dt>
          {inline ? <span className="text-muted-foreground"> · </span> : null}
          <dd
            className={cn(
              "min-w-0 break-words",
              inline && "inline",
              list.names.length === 0 && "text-muted-foreground",
            )}
          >
            {list.names.length > 0 ? list.names.join(", ") : NOBODY}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CrewSections({
  crew,
  look,
  headingId,
}: {
  crew: CrewDay;
  look: "table" | "card" | "phone";
  headingId: string;
}) {
  if (!hasCrew(crew)) return null;
  if (everyoneAvailable(crew)) {
    return (
      <p data-slot="calendar-everyone-available" className="text-muted-foreground text-sm">
        {EVERYONE_AVAILABLE}
      </p>
    );
  }
  const count = crew.busy.length;
  const heading = (
    <h3
      id={headingId}
      data-slot="calendar-bookings-title"
      className={cn(
        "font-semibold",
        look === "card" ? "text-muted-foreground text-xs tracking-wide uppercase" : "text-sm",
      )}
    >
      {look === "phone" ? `${ROLE_LABELS.staff} busy` : "Busy"}{" "}
      <span className="text-muted-foreground font-medium">· {count}</span>
    </h3>
  );
  return (
    <>
      <section
        aria-labelledby={headingId}
        data-slot="calendar-bookings"
        className="flex min-w-0 flex-col gap-2"
      >
        {heading}
        {count === 0 ? (
          <p data-slot="calendar-nobody-busy" className="text-muted-foreground text-sm">
            Nobody busy
          </p>
        ) : look === "table" ? (
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Type</th>
                  <th scope="col">Time</th>
                  <th scope="col">Booked by</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {crew.busy.map((row, index) => (
                  <tr
                    key={`${row.memberId}-${index}`}
                    data-slot="calendar-booking"
                    data-member={row.memberId}
                    className="align-baseline"
                  >
                    <th scope="row" className="py-2.5 pr-2 pl-3 font-medium break-words">
                      {row.name}
                    </th>
                    <td className="px-2 py-2.5 break-words">
                      <TypeDot color={row.color} className="mr-1.5 size-2" />
                      {row.typeName}
                    </td>
                    <td className="px-2 py-2.5 text-xs whitespace-nowrap tabular-nums">
                      {row.when}
                    </td>
                    <td className="text-muted-foreground py-2.5 pr-3 pl-2 break-words">
                      {row.bookedBy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul
            className={cn(
              "divide-border divide-y",
              look === "phone"
                ? "border-border bg-card shadow-raised overflow-hidden rounded-lg border"
                : "border-border -mx-4 border-b",
            )}
          >
            {crew.busy.map((row, index) => (
              <BusyRow key={`${row.memberId}-${index}`} row={row} />
            ))}
          </ul>
        )}
      </section>
      <Names crew={crew} inline={look === "phone"} />
    </>
  );
}
