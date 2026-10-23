import { cn } from "@/core/lib/utils";
import { type KnownStatus, type StatusTone, statusTone } from "@/core/lib/status-tones";
import { Badge } from "@/core/ui/primitives/badge";

/**
 * One badge for every workflow state in DATA-MODEL §0, in exactly six tones. The status → tone
 * map is `core/lib/status-tones.ts` (the single source, B13); this file draws it.
 *
 * One accent per screen: a page that shows a danger badge keeps its buttons neutral.
 */
export {
  attendanceStatus,
  type KnownStatus,
  STATUS_TONES,
  STATUS_TONES_LIST,
  type StatusTone,
  statusTone,
} from "@/core/lib/status-tones";

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
      {/* The leading dot every sample chip has (the design gate, 23 Oct): the tone's own colour,
          so the word and the dot say the same thing. */}
      <span
        aria-hidden
        data-slot="status-badge-dot"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
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
