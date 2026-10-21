import { CheckIcon, CircleAlertIcon, ClockIcon, PalmtreeIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "@/core/lib/utils";

/**
 * The calendar's chips (v1.8 V5b, PP-calendar-2, 3, 5, 7, 8): one look for the month's boxes and
 * the day's dialog, so a thing reads the same wherever it is.
 * - An event: its type's colour as a tint and a left edge, the title first, then its time.
 * - What is due: the amber `attention` tone (red `danger` when overdue, with its alert icon; a
 *   clock otherwise), its type's colour on the edge (a deliverable has none: the tone's).
 * - Leave: its own `leave` tone with the palm icon, "Asha · On leave".
 * - Done: dimmed with a small ✓, never struck through.
 * Tokens only (DESIGN.md §4): a type's colour is data, mixed here like the holiday strip's.
 */

/** An event's or a due chip's edge and tint in its type's colour. */
export function typeTint(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
    borderLeftColor: color,
  };
}

export type DueTone = "due" | "overdue";

/** A due chip's tone: amber, or red when overdue (the soft fill and the tone's text). */
export const DUE_TONE: Record<DueTone, string> = {
  due: "bg-attention-soft text-attention border-l-attention",
  overdue: "bg-danger-soft text-danger border-l-danger",
};

/** The leave chip's and bar's tone. */
export const LEAVE_TONE = "bg-leave-soft text-leave";

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
