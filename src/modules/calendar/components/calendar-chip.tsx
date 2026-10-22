import { CheckIcon, CircleAlertIcon, ClockIcon, PalmtreeIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "@/core/lib/utils";

/**
 * The calendar's chips (v1.8 V5b, PP-calendar-2, 3, 5, 7, 8): one look for the month's boxes and
 * the day's dialog, so a thing reads the same wherever it is.
 * - An event: a small leading dot in its type's colour and the same colour as a soft tint, the
 *   title first, then its time (V5b major change 5: no left-edge stripe).
 * - What is due: the amber `attention` tone (red `danger` when overdue, with its alert icon; a
 *   clock otherwise), its type's colour as the leading dot (a deliverable has none: the icon is
 *   the tone's).
 * - Leave: a soft neutral bar with faint stripes (`leave-stripes`), the palm icon, "Asha · On leave";
 *   never a task type's colour (PP-calendar-10).
 * - Done: dimmed with a small ✓, never struck through.
 * Tokens only (DESIGN.md §4): a type's colour is data, mixed here like the holiday strip's.
 */

/** An event's soft tint in its type's colour (the dot, `TypeDot`, carries the colour itself). */
export function typeTint(color: string): CSSProperties {
  return { backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` };
}

/** The small leading dot in a type's colour (V5b major change 5: the dot plus the tint). */
export function TypeDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="calendar-type-dot"
      className={cn("inline-block size-1.5 shrink-0 rounded-full align-[1px]", className)}
      style={{ backgroundColor: color }}
    />
  );
}

export type DueTone = "due" | "overdue";

/** A due chip's tone: amber, or red when overdue (the soft fill and the tone's text). */
export const DUE_TONE: Record<DueTone, string> = {
  due: "bg-attention-soft text-attention",
  overdue: "bg-danger-soft text-danger",
};

/** The leave chip's and bar's tone: neutral and striped, apart from the task types' colours. */
export const LEAVE_TONE = "leave-stripes text-leave";

/** Overdue's alert or due's clock: the tone is never colour alone (DESIGN.md §4). */
export function DueIcon({ tone, className }: { tone: DueTone; className?: string }) {
  const Icon = tone === "overdue" ? CircleAlertIcon : ClockIcon;
  return (
    <Icon
      data-slot="calendar-due-icon"
      className={cn("inline-block size-3 shrink-0 align-[-2px]", className)}
      aria-hidden
    />
  );
}

/** Leave's palm icon. */
export function LeaveIcon({ className }: { className?: string }) {
  return (
    <PalmtreeIcon
      className={cn("inline-block size-3 shrink-0 align-[-2px]", className)}
      aria-hidden
    />
  );
}

/** Done: the small ✓ beside a dimmed title (PP-calendar-7). */
export function DoneTick({ className }: { className?: string }) {
  return (
    <CheckIcon
      data-slot="calendar-done"
      className={cn("inline-block size-3 shrink-0 align-[-2px]", className)}
      aria-hidden
    />
  );
}
