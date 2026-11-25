"use client";

import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
// The router's own pathname context (what `usePathname` reads): a drawing is drawn at its
// screen's address, so its tabs (`ViewLink`s that mark the current one) mark the tapped one.
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import {
  claimTap,
  type DrawingGroup,
  drawingOrder,
  registerTapSpec,
  type TapSpec,
} from "./tap-skeleton";

/** How a screen draws one of its variants for the viewer. */
export type DrawVariant = (variant: string) => ReactNode;

/**
 * A screen's drawings for one viewer: its spec (without the copies), its variants, and its
 * drawing code, **a chunk of its own** loaded when its first drawing is made: one chunk for every
 * screen put modules only the drawings use (the page header, the loading states) into the pages'
 * own first-load chunks (the bundler merges a large async group's pieces), up to +4.7 KB a route.
 */
export interface TapDrawing {
  spec: Omit<TapSpec, "drawing" | "prepare">;
  group: DrawingGroup;
  variants: readonly string[];
  load: () => Promise<DrawVariant>;
  /** The address the drawing is drawn at (`usePathname`), where its tabs show the current one. */
  at?: string;
}

const drawingId = (key: string, variant: string) => `${key}:${variant}`;

/** The copies, by drawing, and for which viewer they were made (once per page load and viewer). */
const copies = new Map<string, Element>();
/** Each screen's drawing code once loaded, by its key. */
const drawers = new Map<string, DrawVariant>();
let copiesFor: string | null = null;

/**
 * On `<html>`: "ready" once the screens are in the engine (a tap is answered from then on, its
 * drawing made on the finger going down if the pre-render has not reached it), "done" once every
 * drawing is made. For the specs; nothing styles it.
 */
export const TAP_DRAWINGS_ATTRIBUTE = "data-tap-drawings";

/** The longest an idle slice waits for the browser to be idle (a busy page still gets its copies). */
const IDLE_WAIT_MS = 1_000;
/** Where the browser cannot say when it is idle (Safari): a short wait between slices instead. */
const NO_IDLE_WAIT_MS = 50;

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: IDLE_WAIT_MS });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(run, NO_IDLE_WAIT_MS);
  return () => window.clearTimeout(timer);
}

/** The drawings claimed by the links in the viewport, in the order they are on the page. */
function onScreen(): string[] {
  const ids: string[] = [];
  const height = window.innerHeight;
  const width = window.innerWidth;
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const claimed = claimTap(link.getAttribute("href") ?? "", window.location.origin);
    if (claimed === null) continue;
    const box = link.getBoundingClientRect();
    if (
      box.width === 0 ||
      box.bottom < 0 ||
      box.top > height ||
      box.right < 0 ||
      box.left > width
    ) {
      continue;
    }
    ids.push(drawingId(claimed.key, claimed.variant));
  }
  return ids;
}

/**
 * The drawings of the tap-skeleton engine (`tap-skeleton.ts`, v7.0), made **after the page**:
 * each is a screen's own loading screen, rendered into a node outside the document (never on
 * screen, never found by a query) and kept as a copy, which a tap draws. **One per idle slice**
 * (and a screen's code in a slice of its own before its first)
 * (§19 "Nothing forced inside hydration"): the links on screen first, then the viewer's other
 * tabs, then the drill-downs (`drawingOrder`), so no slice is a long task; the finger going down
 * on a link whose drawing is not made yet makes it then (`prepare`), before the click.
 *
 * Mounted once, in the shell (the `(app)` layout's after-page part), so the copies outlive every
 * screen; made once per page load and viewer (a later mount for the same viewer draws nothing).
 * Core holds no screen: the app passes the drawings (`app/(app)/tap-drawings.tsx`).
 */
export function TapDrawingHost({
  drawings,
  viewer,
}: {
  drawings: readonly TapDrawing[];
  /** Whose drawings these are (the role): another viewer's copies are made again. */
  viewer: string;
}) {
  const [offscreen] = useState(() => document.createElement("div"));
  const [current, setCurrent] = useState<{
    id: string;
    node: ReactNode;
    at: string | undefined;
  } | null>(null);

  useEffect(() => {
    if (copiesFor !== viewer) {
      copies.clear();
      drawers.clear();
      copiesFor = viewer;
    }
    let live = true;
    const byKey = new Map(drawings.map((drawing) => [drawing.spec.key, drawing]));
    const loading = new Map<string, Promise<DrawVariant | null>>();
    /** The screen's drawing code, loaded once (a failed load is tried again on the next ask). */
    const drawer = (key: string): Promise<DrawVariant | null> => {
      const known = drawers.get(key);
      if (known) return Promise.resolve(known);
      const asked = loading.get(key);
      if (asked) return asked;
      const drawing = byKey.get(key);
      if (!drawing) return Promise.resolve(null);
      const load = drawing.load().then(
        (draw) => {
          drawers.set(key, draw);
          return draw;
        },
        () => {
          loading.delete(key);
          return null;
        },
      );
      loading.set(key, load);
      return load;
    };
    /** Draws one variant now, in one commit (`flushSync`): the copy is made in its layout effect. */
    const drawNow = (key: string, variant: string) => {
      const id = drawingId(key, variant);
      const draw = drawers.get(key);
      if (!live || copies.has(id) || !draw) return;
      const started = performance.now();
      const at = byKey.get(key)?.at;
      flushSync(() => setCurrent({ id, node: draw(variant), at }));
      // The slice's length, for the long-task check (`e2e/instant-skeleton.spec.ts`); a browser
      // without measure options draws all the same.
      try {
        performance.measure(`tap-drawing:${id}`, { start: started, end: performance.now() });
      } catch {
        // nothing to measure with
      }
    };
    for (const { spec } of drawings) {
      registerTapSpec({
        ...spec,
        drawing: (variant) => copies.get(drawingId(spec.key, variant)),
        // The finger going down on a link whose drawing is not made yet: now, if its code is in;
        // else its code is fetched and it is drawn when it lands (the 120 ms timer may still
        // find it).
        prepare: (variant) => {
          if (drawers.has(spec.key)) drawNow(spec.key, variant);
          else void drawer(spec.key).then(() => drawNow(spec.key, variant));
        },
      });
    }
    document.documentElement.setAttribute(TAP_DRAWINGS_ATTRIBUTE, "ready");
    const queue = drawingOrder(
      drawings.flatMap(({ spec, group, variants }) =>
        variants.map((variant) => ({ id: drawingId(spec.key, variant), group })),
      ),
      onScreen(),
    );
    let stop = () => {};
    const step = () => {
      if (!live) return;
      const next = queue.find((id) => !copies.has(id));
      if (next === undefined) {
        setCurrent(null);
        document.documentElement.setAttribute(TAP_DRAWINGS_ATTRIBUTE, "done");
        return;
      }
      const [key = "", variant = ""] = next.split(":");
      if (drawers.has(key)) {
        drawNow(key, variant);
        // A drawing that cannot be made (its screen gone from the list) is not asked for again.
        if (!copies.has(next)) queue.splice(queue.indexOf(next), 1);
        stop = whenIdle(step);
        return;
      }
      // Its code first, in a slice of its own; the drawing in the next.
      void drawer(key).then((draw) => {
        if (!draw) queue.splice(queue.indexOf(next), 1);
        if (live) stop = whenIdle(step);
      });
    };
    stop = whenIdle(step);
    return () => {
      live = false;
      stop();
    };
  }, [drawings, viewer]);

  // In the same commit as the drawing: the copy is there once `flushSync` returns.
  useLayoutEffect(() => {
    const drawn = offscreen.firstElementChild;
    if (current !== null && drawn !== null) {
      copies.set(current.id, drawn.cloneNode(true) as Element);
    }
  }, [current, offscreen]);

  if (current === null) return null;
  return createPortal(
    <div key={current.id} data-tap-drawing={current.id}>
      {current.at === undefined ? (
        current.node
      ) : (
        <PathnameContext.Provider value={current.at}>{current.node}</PathnameContext.Provider>
      )}
    </div>,
    offscreen,
  );
}
