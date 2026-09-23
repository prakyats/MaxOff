import { cn } from "@/core/lib/utils";
import { Badge } from "@/core/ui/primitives/badge";

/**
 * One badge for every workflow state in DATA-MODEL §0, in exactly six tones
 * (ARCHITECTURE §3.3). Code depends only on those enums (ADR-0002), so new task types or stage
 * names never need a new badge: they're plain data. The map is keyed by the enum *value*, which
 * is shared across enums where the meaning matches (`approved`, `cancelled`, `open`, ...).
 * `status-badge.test.ts` proves every value maps to a tone and every tone passes 4.5:1.
 *
 * One accent per screen: a page that shows a danger badge keeps its buttons neutral.
 */
export const STATUS_TONES_LIST = [
  "success",
  "info",
  "attention",
  "danger",
  "neutral",
  "brand",
] as const;
export type StatusTone = (typeof STATUS_TONES_LIST)[number];

export const STATUS_TONES = {
  // success: finished and accepted
  approved: "success",
  completed: "success",
  done: "success",
  settled: "success",
  billed: "success",
  present: "success",
  active: "success",
  // info: work in motion, nothing else
  in_progress: "info",
  submitted: "info",
  converted: "info",
  // attention: someone must act
  admin_approved: "attention",
  pending_review: "attention",
  awaiting_choice: "attention",
  changes_requested: "attention",
  pending: "attention",
  paused: "attention",
  leave_pending: "attention",
  not_billed: "attention",
  high: "attention",
  // danger: act now
  rejected: "danger",
  absent: "danger",
  cancelled: "danger",
  declined: "danger",
  urgent: "danger",
  // neutral: not started, closed quietly, informational, or a plain label
  invited: "neutral",
  leave: "neutral",
  half_day: "neutral",
  comp_leave: "neutral",
  carry_forward: "neutral",
  corrected: "neutral",
  draft: "neutral",
  todo: "neutral",
  open: "neutral",
  inactive: "neutral",
  withdrawn: "neutral",
  superseded: "neutral",
  carried: "neutral",
  close: "neutral",
  deactivated: "neutral",
  required: "neutral",
  none: "neutral",
  skipped: "neutral",
  medium: "neutral",
  low: "neutral",
} as const satisfies Record<string, StatusTone>;

export type KnownStatus = keyof typeof STATUS_TONES;

const LABEL_OVERRIDES: Partial<Record<KnownStatus, string>> = {
  todo: "To do",
  comp_leave: "Comp leave",
  half_day: "Half day",
};

/** The solid tone colour, used as the dot in `StatusDot`. */
export const TONE_DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-success",
  info: "bg-info",
  attention: "bg-attention",
  danger: "bg-danger",
  neutral: "bg-neutral",
  brand: "bg-brand",
};

/** Text and background come from the tone tokens in globals.css, so contrast is fixed once. */
const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  attention: "bg-attention-soft text-attention",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-neutral-soft text-neutral",
  brand: "bg-brand-soft text-brand",
};

export function statusTone(status: string): StatusTone {
  return (STATUS_TONES as Record<string, StatusTone>)[status] ?? "neutral";
}

/** `in_progress` → "In progress". Unknown values get the same treatment. */
export function statusLabel(status: string): string {
  const override = (LABEL_OVERRIDES as Record<string, string | undefined>)[status];
  if (override) return override;
  const words = status.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusBadge({
  status,
  label,
  tone,
  className,
}: {
  status: string;
  /** Overrides the derived label, e.g. a stage name that is data. */
  label?: string;
  /** Overrides the derived tone. */
  tone?: StatusTone;
  className?: string;
}) {
  const resolved = tone ?? statusTone(status);
  return (
    <Badge
      variant="outline"
      data-status={status}
      data-tone={resolved}
      className={cn("border-transparent", TONE_CLASSES[resolved], className)}
    >
      {label ?? statusLabel(status)}
    </Badge>
  );
}

/**
 * The same meaning as `StatusBadge`, as **a coloured dot plus a short word** — what a status
 * looks like on a phone (ARCHITECTURE §14.1: "not a full-width badge column"). A card has one
 * line for identity and one glance for state; a pill eats the width the name needs.
 *
 * The word is plain foreground text, so its contrast never depends on the tone; the tone is
 * carried by the dot, and the word says the same thing for anyone who can't see the colour.
 */
export function StatusDot({
  status,
  label,
  tone,
  className,
}: {
  status: string;
  label?: string;
  tone?: StatusTone;
  className?: string;
}) {
  const resolved = tone ?? statusTone(status);
  return (
    <span
      data-slot="status-dot"
      data-status={status}
      data-tone={resolved}
      className={cn("text-foreground inline-flex items-center gap-1.5 text-xs", className)}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", TONE_DOT_CLASSES[resolved])}
      />
      {label ?? statusLabel(status)}
    </span>
  );
}
