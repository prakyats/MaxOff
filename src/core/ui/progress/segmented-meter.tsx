import { cn } from "@/core/lib/utils";

/**
 * The segmented progress meter (ROADMAP 6b.11 (5); owner 2026-10-10: "very premium, high
 * quality", to motivate by showing the work moving): one segment per step, the done ones solid,
 * the next ones lighter, the rest a quiet track. A **ring** for a cycle on its project page; the
 * one continuous **bar** (`ProgressBar`, P4) in miniature wherever a project, a cycle or a
 * deliverable is listed, and the same bar (nothing done yet) on the template preview's cards. Server-safe (no hooks), so a list pays no
 * JavaScript for it.
 *
 * Colours come from the tokens only (green = done in the one colour code; never red, which stays
 * for urgency), in light and dark. A change eases in (colour, or the arc's length past
 * `SEGMENTED_MAX` steps, where segments would be too thin to read) and is static under reduced
 * motion. The meter's box never depends on its numbers, so nothing moves when they change.
 */

export type MeterCounts = { done: number; next: number; total: number };

/** Past this many steps the meter draws continuous arcs instead of segments. */
export const SEGMENTED_MAX = 48;

const EASE =
  "transition-[stroke,background-color,stroke-dasharray,stroke-dashoffset,width] duration-700 ease-out motion-reduce:transition-none";
const TONE_STROKE = {
  done: "stroke-success",
  next: "stroke-success/35",
  rest: "stroke-neutral-soft",
};
const TONE_FILL = { done: "bg-success", next: "bg-success/35", rest: "bg-neutral-soft" };

type Tone = keyof typeof TONE_STROKE;

/** Each segment's tone, in order: the done ones, then the next ones, then the rest. */
export function segmentTones(counts: MeterCounts): Tone[] {
  const total = Math.max(0, counts.total);
  const done = Math.min(Math.max(0, counts.done), total);
  const next = Math.min(Math.max(0, counts.next), total - done);
  return Array.from({ length: total }, (_, index) =>
    index < done ? "done" : index < done + next ? "next" : "rest",
  );
}

/** The segments' place on a ring whose length is 100: each one's start and length, with a gap. */
export function ringSegments(total: number): { offset: number; length: number }[] {
  if (total <= 0) return [];
  if (total === 1) return [{ offset: 0, length: 100 }];
  const step = 100 / total;
  const gap = Math.min(1.4, step * 0.3);
  return Array.from({ length: total }, (_, index) => ({
    offset: index * step + gap / 2,
    length: step - gap,
  }));
}

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

const meterData = (counts: MeterCounts) => ({
  "data-done": counts.done,
  "data-next": counts.next,
  "data-total": counts.total,
});

/**
 * The ring, square, sized by `className` (`size-20` …), with `children` centred in it (the big
 * figure). `label` is what assistive tech reads ("68%: 12 of 18 stages").
 */
export function ProgressRing({
  counts,
  label,
  className,
  children,
  slot = "progress-ring",
}: {
  counts: MeterCounts;
  label: string;
  className?: string;
  children?: React.ReactNode;
  slot?: string;
}) {
  const segmented = counts.total <= SEGMENTED_MAX;
  const tones = segmentTones(counts);
  const done = share(Math.min(counts.done, counts.total), counts.total);
  const next = share(Math.min(counts.next, counts.total - counts.done), counts.total);
  const ring = { cx: 50, cy: 50, r: 43, fill: "none", strokeWidth: 8, pathLength: 100 } as const;
  return (
    <div
      role="img"
      aria-label={label}
      data-slot={slot}
      {...meterData(counts)}
      className={cn("relative shrink-0", className)}
    >
      <svg viewBox="0 0 100 100" aria-hidden className="size-full -rotate-90">
        {segmented ? (
          ringSegments(counts.total).map((segment, index) => (
            <circle
              key={index}
              {...ring}
              data-tone={tones[index]}
              strokeDasharray={`${segment.length} ${100 - segment.length}`}
              strokeDashoffset={-segment.offset}
              className={cn(EASE, TONE_STROKE[tones[index] ?? "rest"])}
            />
          ))
        ) : (
          <>
            <circle {...ring} className={TONE_STROKE.rest} />
            <circle
              {...ring}
              strokeDasharray={`${next} ${100 - next}`}
              strokeDashoffset={-done}
              className={cn(EASE, TONE_STROKE.next)}
            />
            <circle
              {...ring}
              strokeDasharray={`${done} ${100 - done}`}
              className={cn(EASE, TONE_STROKE.done)}
            />
          </>
        )}
        {counts.total === 0 ? <circle {...ring} className={TONE_STROKE.rest} /> : null}
      </svg>
      {children ? (
        <span className="absolute inset-0 flex items-center justify-center">{children}</span>
      ) : null}
    </div>
  );
}

/**
 * The one progress bar (P4, UX review 2026-10-21: two bar designs sat side by side on a client's
 * Projects tab): a thin continuous bar, full width of its box, done solid, next lighter, the rest
 * a quiet track, whatever the number of steps (the long-stage fix C: no row of dots to count).
 * The ring alone keeps segments. `label` is what assistive tech reads; omit it (`null`) where the
 * words beside it already say the same.
 */
export function ProgressBar({
  counts,
  label,
  className,
  slot = "progress-bar",
}: {
  counts: MeterCounts;
  label: string | null;
  className?: string;
  slot?: string;
}) {
  const a11y = label === null ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  const done = Math.min(Math.max(0, counts.done), Math.max(0, counts.total));
  const next = Math.min(Math.max(0, counts.next), Math.max(0, counts.total) - done);
  return (
    <span
      {...a11y}
      data-slot={slot}
      {...meterData(counts)}
      className={cn("bg-neutral-soft relative flex h-1.5 overflow-hidden rounded-full", className)}
    >
      <span
        data-tone="done"
        className={cn(EASE, TONE_FILL.done, "h-full")}
        style={{ width: `${share(done, counts.total)}%` }}
      />
      <span
        data-tone="next"
        className={cn(EASE, TONE_FILL.next, "h-full")}
        style={{ width: `${share(next, counts.total)}%` }}
      />
    </span>
  );
}
