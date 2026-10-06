import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";
import { type AlertsFilter as Filter, alertsHref } from "@/modules/notifications-center";

const OPTIONS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
];

/**
 * Alerts' "All | Unread" filter (5B decision 10). View state: `ViewLink`s replace the entry, so
 * switching never adds history and one back leaves Alerts (ARCHITECTURE §14.2 d); the address
 * keeps it (`?show=unread`) for a refresh. Switching starts again at the first page. `current` is
 * null in the loading skeleton (the same control, nothing chosen yet).
 */
export function AlertsFilter({ current }: { current: Filter | null }) {
  return (
    <nav
      aria-label="Show alerts"
      data-slot="alerts-filter"
      className="bg-muted mb-3 grid grid-cols-2 gap-1 rounded-lg p-1 md:inline-grid md:w-64"
    >
      {OPTIONS.map(({ value, label }) => (
        <ViewLink
          key={value}
          href={alertsHref(value)}
          scroll={false}
          aria-current={current === value ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md px-2 text-center text-sm font-medium outline-none select-none focus-visible:ring-2",
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
