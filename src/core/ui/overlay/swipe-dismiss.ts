"use client";

import { type PointerEvent, type MouseEvent, useRef } from "react";

/**
 * Swipe down to close a bottom sheet (ARCHITECTURE §14.2 i, first built for the phone Select
 * sheet in the 3B review fixes). No gesture library: a pointer drag on the sheet that moves it
 * with the finger and closes it past a distance or at a flick's speed, springing back otherwise.
 *
 * The drag starts only downward and only while the sheet's list (`[data-swipe-scroll]`) is at
 * its top, so scrolling a long list up never closes the sheet. A drag never becomes a tap: the
 * pointer is captured once dragging starts and a click that follows is swallowed.
 */

/** Past this many pixels a release closes the sheet. */
export const DISMISS_DISTANCE = 80;
/** A shorter flick closes it when it is at least this fast (px per ms) and this long. */
export const FLICK_SPEED = 0.5;
export const FLICK_DISTANCE = 24;
/** Movement below this is still a tap. */
export const DRAG_SLOP = 10;

/** Whether a release after dragging `distance` px down in `elapsedMs` closes the sheet. Pure. */
export function swipeDismisses(distance: number, elapsedMs: number): boolean {
  if (distance >= DISMISS_DISTANCE) return true;
  return distance >= FLICK_DISTANCE && distance / Math.max(elapsedMs, 1) >= FLICK_SPEED;
}

/**
 * What a move means before the drag has started: keep watching, start the drag, or give up
 * (sideways, upward, or the list is scrolled). Pure.
 */
export function dragIntent(dx: number, dy: number, listAtTop: boolean): "wait" | "drag" | "none" {
  if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return "wait";
  // Sideways or upward is not a dismiss; neither is pulling a list that is scrolled down.
  if (dy <= Math.abs(dx)) return "none";
  return listAtTop ? "drag" : "none";
}

type Drag = { id: number; x: number; y: number; t: number; dy: number; dragging: boolean };

/** Pointer handlers for the sheet's content element. `onDismiss` closes the sheet. */
export function useSwipeDismiss(onDismiss: () => void) {
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);

  function settle(element: HTMLElement) {
    element.style.transition = "";
    element.style.transform = "";
  }

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      swallowClick.current = false;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        t: event.timeStamp,
        dy: 0,
        dragging: false,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      const element = event.currentTarget;
      if (!current.dragging) {
        const list = element.querySelector<HTMLElement>("[data-swipe-scroll]");
        const intent = dragIntent(dx, dy, (list?.scrollTop ?? 0) <= 0);
        if (intent === "none") drag.current = null;
        if (intent !== "drag") return;
        current.dragging = true;
        element.setPointerCapture?.(event.pointerId);
        element.style.transition = "none";
      }
      current.dy = Math.max(0, dy);
      element.style.transform = `translateY(${current.dy}px)`;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      drag.current = null;
      if (!current?.dragging) return;
      swallowClick.current = true;
      const element = event.currentTarget;
      if (swipeDismisses(current.dy, event.timeStamp - current.t)) {
        onDismiss();
      } else {
        settle(element);
      }
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      drag.current = null;
      settle(event.currentTarget);
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
