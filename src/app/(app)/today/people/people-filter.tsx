import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";
import type { PeopleGroup } from "@/modules/dashboards";

const OPTIONS: readonly { value: PeopleGroup; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "waiting", label: "Waiting" },
  { value: "not_chosen", label: "Not started" },
  { value: "present", label: "Present" },
  { value: "on_leave", label: "On leave" },
  { value: "absent", label: "Absent" },
  // Decision 24: the card's "End of day not recorded" count opens the board on this one.
  { value: "end_not_recorded", label: "End not recorded" },
];

/** The board's header line, shared with its loading screen (nothing moves when it arrives). */
export const PEOPLE_DESCRIPTION = "Everyone expected today, by where they stand.";

export function peopleHref(group: PeopleGroup): string {
  return group === "all" ? "/today/people" : `/today/people?group=${group}`;
}

/**
 * The full board's group filter (6.2): a count on Today opens the board on its group, and these
 * switch it. View state: `ViewLink`s replace the entry, so switching never adds history and one
 * back returns to Today (ARCHITECTURE §14.2 d). `current` is null in the loading skeleton.
 */
export function PeopleFilter({ current }: { current: PeopleGroup | null }) {
  return (
    <nav
      aria-label="Show people"
      data-slot="people-filter"
      className="bg-muted mb-4 flex flex-wrap gap-1 rounded-lg p-1 md:inline-flex"
    >
      {OPTIONS.map(({ value, label }) => (
        <ViewLink
          key={value}
          href={peopleHref(value)}
          scroll={false}
          aria-current={current === value ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-11 flex-[1_1_7rem] items-center justify-center rounded-md px-3 text-center text-sm font-medium outline-none select-none focus-visible:ring-2 md:flex-none",
            current === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground active:bg-background/60",
          )}
        >
          {label}
        </ViewLink>
      ))}
    </nav>
  );
}
