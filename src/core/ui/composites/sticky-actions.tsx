"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

import { cn } from "@/core/lib/utils";

/** The bar's height, read by the page padding and the fields' scroll margin (globals.css). */
const HEIGHT_VAR = "--app-sticky-actions-h";

/**
 * A form's submit row: **a sticky bar at the bottom of the viewport on a phone**, above the
 * bottom bar and the home indicator, and an ordinary row in the flow on desktop
 * (ARCHITECTURE §14.1: "the primary action is reachable … never hidden behind the keyboard").
 *
 * A list screen's one action is a FAB instead — `PageHeader`'s `actions` handles that. Save is
 * a bar because it is wide, often paired with a Cancel, and belongs to the form, not the page.
 *
 * Like `page-actions` this is one element repositioned by CSS, not a mobile copy and a desktop
 * copy, so a form never submits from two buttons.
 *
 * **Phone:** an elevated surface of the card token (a form lives on a card or a sheet, never on
 * the bare page): a top border, a subtle upward shadow so it separates from the content scrolling
 * under it, and the side safe areas. **From `md` up:** not a bar at all, just the
 * form's last row: no background, no border, no padding, buttons right-aligned in their DOM
 * order (Cancel, then Save). Before 2.9's review it kept `bg-background` there, which drew a
 * page-coloured band across the card behind the buttons (owner's check, 2026-09-26).
 *
 * **Room for it (phase 3 review, owner's phone walk):** while mounted it publishes its measured
 * height as `--app-sticky-actions-h` on `<html>`; below `md` the page reserves that height plus
 * the bottom bar and the safe area, and every field keeps the same scroll margin, so the last
 * field can scroll above the bar and a focused one lands above it, at any text size.
 */
export function StickyActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(HEIGHT_VAR, `${bar.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-slot="sticky-actions"
      className={cn(
        "border-border bg-card/95 supports-[backdrop-filter]:bg-card/85 fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+var(--app-safe-bottom)+var(--app-offline-h,0px))] z-30 flex gap-2 border-t py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.25)] backdrop-blur",
        "*:flex-1",
        "md:static md:justify-end md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none md:*:flex-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
