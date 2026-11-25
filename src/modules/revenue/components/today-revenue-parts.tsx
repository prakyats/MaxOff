import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The Today line's boxes and its two states before the figures, shared by the server line, the
 * stand-in drawn until the tap's code is in, and the loaded part, so each replaces the other in
 * place (ARCHITECTURE §14.1). No figure is ever passed here.
 */
export const TODAY_REVENUE_CARD =
  "border-border bg-card shadow-raised flex min-h-16 items-center gap-3 overflow-hidden rounded-lg border px-4 py-2 text-sm";
export const TODAY_REVENUE_LINK =
  "pressable text-foreground hover:bg-muted focus-visible:ring-ring rounded-control flex min-h-11 shrink-0 items-center gap-1 px-2 font-medium outline-none focus-visible:ring-2";
/** The line's text box: one 44 px tap target across the free width. */
export const TODAY_REVENUE_TEXT = "flex min-h-11 min-w-0 flex-1 items-center";
const TOGGLE =
  "focus-visible:ring-ring rounded-control min-h-11 min-w-0 flex-1 cursor-pointer text-left break-words tabular-nums outline-none select-none focus-visible:ring-2";

/** "November · ₹ ••• achieved of ₹ ••• · Show" (or "· Hide" with the figures), one button. */
export function TodayRevenueToggle({
  words,
  shown,
  onPress,
}: {
  words: string;
  shown: boolean;
  /** None on the server's stand-in: its wrapper hears the tap (`TodayRevenueShow`). */
  onPress?: () => void;
}) {
  return (
    <button
      type="button"
      className={`pressable ${TOGGLE}`}
      aria-expanded={shown}
      data-slot="today-revenue-toggle"
      onClick={onPress}
    >
      <span data-slot={shown ? "today-revenue-figures" : "today-revenue-masked"}>{words}</span>
      <span className="font-medium"> · {shown ? "Hide" : "Show"}</span>
    </button>
  );
}

/** While the figures are on their way: one bar in the text's box. */
export function TodayRevenueLoading() {
  return (
    <span
      className={TODAY_REVENUE_TEXT}
      role="status"
      aria-label="Loading revenue"
      data-slot="today-revenue-loading"
    >
      <Skeleton className="h-3.5 w-3/4" />
    </span>
  );
}
