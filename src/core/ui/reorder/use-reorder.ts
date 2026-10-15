"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  dropIndex,
  edgeScrollStep,
  LONG_PRESS_MS,
  moveAnnouncement,
  pressOutcome,
} from "./reorder-math";

/**
 * Drag to reorder one list (ROADMAP 6b.18; ARCHITECTURE §14.1, §14.2 i). Pointer events, no
 * dependency: a mouse or a pen drags from the handle at once, a touch after a long press
 * (`LONG_PRESS_MS`; moving first is a swipe and gives the gesture back). While dragging, the row
 * follows the pointer with a transform and a line marks where it lands, so nothing else in the
 * list moves (no layout jump); near the scroller's edges the list scrolls. The order changes once,
 * on release, through `onMove(from, to)`. `move` is the same change for Move up / Move down (the
 * keyboard and screen-reader way, WCAG 2.5.7); both announce the new place in the list's live
 * region.
 *
 * Nested lists work as separate hooks: a row is the closest `[data-reorder-item]` to its handle
 * and its list is that row's parent, so dragging a group moves the whole group and dragging a
 * stage moves it within its group. Nothing animates, so reduced motion needs no exception.
 */

type Session = {
  index: number;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  startTime: number;
  y: number;
  phase: "pressing" | "dragging";
  timer: ReturnType<typeof setTimeout> | null;
  frame: number | null;
  handle: HTMLElement;
  item: HTMLElement | null;
  list: HTMLElement | null;
  scroller: HTMLElement | null;
  startScroll: number;
  target: number;
};

export type ReorderHandleProps = {
  "data-slot": "reorder-handle";
  "data-reorder-handle": number;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
};

export type Reorder = {
  /** The row being dragged, or null. */
  dragging: number | null;
  /** The live region's latest words ("Moved … to position 2 of 3."). */
  announcement: string;
  count: number;
  /** The props a row's drag handle spreads. */
  handleProps: (index: number) => ReorderHandleProps;
  /** Move a row (Move up / Move down), announcing it. */
  move: (from: number, to: number) => void;
};

function rowsOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute("data-reorder-item"),
  );
}

function indicatorOf(list: HTMLElement): HTMLElement | null {
  return (
    Array.from(list.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.hasAttribute("data-reorder-indicator"),
    ) ?? null
  );
}

function scrollerOf(node: HTMLElement): HTMLElement | null {
  for (let current = node.parentElement; current; current = current.parentElement) {
    const { overflowY } = getComputedStyle(current);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight
    )
      return current;
  }
  return null;
}

function scrollTopOf(scroller: HTMLElement | null): number {
  return scroller ? scroller.scrollTop : window.scrollY;
}

/** Moves the dragged row with the pointer and the drop line to where it would land. */
function place(s: Session): void {
  const { item, list } = s;
  if (!item || !list) return;
  const others = rowsOf(list).filter((row) => row !== item);
  const boxes = others.map((row) => row.getBoundingClientRect());
  s.target = dropIndex(
    boxes.map((box) => box.top + box.height / 2),
    s.y,
  );
  const scrolled = scrollTopOf(s.scroller) - s.startScroll;
  item.style.transform = `translate3d(0, ${s.y - s.startY + scrolled}px, 0)`;
  const indicator = indicatorOf(list);
  if (!indicator) return;
  if (s.target === s.index || boxes.length === 0) {
    indicator.hidden = true;
    return;
  }
  const listTop = list.getBoundingClientRect().top;
  const next = boxes[s.target];
  const last = boxes[boxes.length - 1];
  const edge = next ? next.top - 3 : (last?.bottom ?? listTop) + 1;
  indicator.style.top = `${edge - listTop}px`;
  indicator.hidden = false;
}

/** One frame of edge scrolling while the drag lasts; it schedules the next itself. */
function scrollFrame(s: Session): void {
  if (s.phase !== "dragging") return;
  const box = s.scroller?.getBoundingClientRect();
  const top = Math.max(0, box?.top ?? 0);
  const bottom = Math.min(window.innerHeight, box?.bottom ?? window.innerHeight);
  const step = edgeScrollStep(s.y, top, bottom);
  if (step !== 0) {
    if (s.scroller) s.scroller.scrollTop += step;
    else window.scrollBy(0, step);
    place(s);
  }
  s.frame = requestAnimationFrame(() => scrollFrame(s));
}

export function useReorder({
  count,
  onMove,
  labelOf,
  disabled = false,
}: {
  count: number;
  onMove: (from: number, to: number) => void;
  /** The row's name in announcements. */
  labelOf: (index: number) => string;
  disabled?: boolean;
}): Reorder {
  const [dragging, setDragging] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const session = useRef<Session | null>(null);
  const latest = useRef({ count, onMove, labelOf });
  useEffect(() => {
    latest.current = { count, onMove, labelOf };
  });

  const move = useCallback((from: number, to: number) => {
    const { count: total, onMove: commit, labelOf: nameOf } = latest.current;
    if (to < 0 || to >= total || from === to) return;
    const label = nameOf(from);
    commit(from, to);
    setAnnouncement(moveAnnouncement(label, to, total));
  }, []);

  const end = useCallback(
    (commit: boolean) => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      const wasDragging = s.phase === "dragging";
      s.phase = "pressing";
      if (s.timer !== null) clearTimeout(s.timer);
      if (s.frame !== null) cancelAnimationFrame(s.frame);
      if (s.item) s.item.style.transform = "";
      const indicator = s.list ? indicatorOf(s.list) : null;
      if (indicator) indicator.hidden = true;
      try {
        if (s.handle.hasPointerCapture(s.pointerId)) s.handle.releasePointerCapture(s.pointerId);
      } catch {
        // The pointer is already gone; nothing to release.
      }
      if (wasDragging) {
        setDragging(null);
        if (commit && s.target !== s.index) move(s.index, s.target);
      }
    },
    [move],
  );

  const start = useCallback((s: Session) => {
    s.phase = "dragging";
    s.timer = null;
    s.item = s.handle.closest<HTMLElement>("[data-reorder-item]");
    s.list = s.item?.parentElement ?? null;
    s.scroller = s.list ? scrollerOf(s.list) : null;
    s.startScroll = scrollTopOf(s.scroller);
    setDragging(s.index);
    place(s);
    s.frame = requestAnimationFrame(() => scrollFrame(s));
  }, []);

  useEffect(() => () => end(false), [end]);

  const handleProps = useCallback(
    (index: number): ReorderHandleProps => ({
      "data-slot": "reorder-handle",
      "data-reorder-handle": index,
      onPointerDown: (event) => {
        if (disabled || session.current || event.button !== 0) return;
        // No text selection, no focus change and (with `touch-action: none`) no scroll.
        if (event.pointerType !== "touch") event.preventDefault();
        const handle = event.currentTarget;
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          // A synthetic pointer cannot be captured; the drag still follows its events.
        }
        const s: Session = {
          index,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startX: event.clientX,
          startY: event.clientY,
          startTime: performance.now(),
          y: event.clientY,
          phase: "pressing",
          timer: null,
          frame: null,
          handle,
          item: null,
          list: null,
          scroller: null,
          startScroll: 0,
          target: index,
        };
        session.current = s;
        if (pressOutcome({ pointerType: s.pointerType, elapsed: 0, distance: 0 }) === "drag")
          start(s);
        else
          s.timer = setTimeout(() => {
            if (session.current === s && s.phase === "pressing") start(s);
          }, LONG_PRESS_MS);
      },
      onPointerMove: (event) => {
        const s = session.current;
        if (!s || s.pointerId !== event.pointerId) return;
        s.y = event.clientY;
        if (s.phase === "pressing") {
          const outcome = pressOutcome({
            pointerType: s.pointerType,
            elapsed: performance.now() - s.startTime,
            distance: Math.hypot(event.clientX - s.startX, event.clientY - s.startY),
          });
          if (outcome === "cancel") end(false);
          else if (outcome === "drag") start(s);
          return;
        }
        event.preventDefault();
        place(s);
      },
      onPointerUp: (event) => {
        if (session.current?.pointerId === event.pointerId) end(true);
      },
      onPointerCancel: (event) => {
        if (session.current?.pointerId === event.pointerId) end(false);
      },
      onLostPointerCapture: (event) => {
        const s = session.current;
        // Losing the capture before release (the page took the pointer) cancels the drag.
        if (s?.pointerId === event.pointerId && s.phase === "pressing") end(false);
      },
      // A long press on Android opens the context menu; on the handle it starts a drag instead.
      onContextMenu: (event) => event.preventDefault(),
    }),
    [disabled, end, start],
  );

  return { dragging, announcement, count, handleProps, move };
}
