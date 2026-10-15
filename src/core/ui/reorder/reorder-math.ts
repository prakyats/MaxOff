/**
 * The pure parts of drag to reorder (ROADMAP 6b.18; ARCHITECTURE §14.1, §14.2 i): where a dragged
 * row lands, when a press becomes a drag, how fast the list scrolls near its edges, and what the
 * live region says. No DOM here, so every rule has a unit test.
 */

/** A touch press held this long (ms) without moving starts a drag (a long press). */
export const LONG_PRESS_MS = 300;
/** A touch that moves farther than this (px) before the long press is a scroll, not a drag. */
export const LONG_PRESS_SLOP = 8;
/** The band (px) at a scroller's top and bottom edge where a drag scrolls the list. */
export const EDGE_ZONE = 56;
/** The fastest edge scroll, in px per animation frame. */
export const EDGE_SPEED_MAX = 18;

/** The list with the entry at `from` moved to `to` (clamped); a new array, never in place. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (target === from) return next;
  const [entry] = next.splice(from, 1);
  next.splice(target, 0, entry as T);
  return next;
}

/**
 * Where a dragged row lands: the number of the **other** rows (in order, the dragged one left
 * out) whose middle is above the pointer. That is the dragged row's index after the move.
 */
export function dropIndex(otherMiddles: readonly number[], pointerY: number): number {
  let index = 0;
  for (const middle of otherMiddles) if (middle < pointerY) index += 1;
  return index;
}

export type PressOutcome = "wait" | "drag" | "cancel";

/**
 * What a press on a drag handle is so far. A mouse or a pen drags at once (press and drag); a
 * touch drags only after a long press, and moving first gives the gesture back (it was a swipe).
 */
export function pressOutcome(press: {
  pointerType: string;
  elapsed: number;
  distance: number;
}): PressOutcome {
  if (press.pointerType !== "touch") return "drag";
  if (press.elapsed >= LONG_PRESS_MS) return "drag";
  return press.distance > LONG_PRESS_SLOP ? "cancel" : "wait";
}

/**
 * How far the scroller moves this frame while a drag is at `pointerY`: negative near the top
 * edge, positive near the bottom, faster the closer to the edge, zero elsewhere.
 */
export function edgeScrollStep(
  pointerY: number,
  top: number,
  bottom: number,
  zone: number = EDGE_ZONE,
  max: number = EDGE_SPEED_MAX,
): number {
  if (bottom - top <= zone * 2) return 0;
  if (pointerY < top + zone) {
    const depth = Math.min(1, (top + zone - pointerY) / zone);
    return -Math.ceil(depth * max);
  }
  if (pointerY > bottom - zone) {
    const depth = Math.min(1, (pointerY - (bottom - zone)) / zone);
    return Math.ceil(depth * max);
  }
  return 0;
}

/** The live region's words after a move ("Moved Phase A to position 2 of 3."). */
export function moveAnnouncement(label: string, to: number, count: number): string {
  return `Moved ${label} to position ${to + 1} of ${count}.`;
}
