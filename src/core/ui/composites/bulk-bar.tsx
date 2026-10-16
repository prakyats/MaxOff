"use client";

import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/primitives/button";

/**
 * Floating action bar shown while rows are selected (bulk approve, reject, reassign).
 * Renders nothing when `count` is 0. Sits above the Staff bottom nav on phones. `onHeight` hears
 * the bar's height (0 when it is gone), so a screen can reserve that space under its list and its
 * last row can scroll clear of the bar (unit U).
 */
export function BulkBar({
  count,
  onClear,
  children,
  className,
  noun = "selected",
  onHeight,
}: {
  /** The bar's height in px whenever it changes; 0 once it is gone. */
  onHeight?: ((height: number) => void) | undefined;
  count: number;
  onClear: () => void;
  children: ReactNode;
  className?: string;
  /** Word after the number, e.g. "tasks selected". */
  noun?: string;
}) {
  const report = useRef(onHeight);
  useEffect(() => {
    report.current = onHeight;
  });
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) {
      report.current?.(0);
      return;
    }
    if (!report.current) return;
    const watch = new ResizeObserver(() => report.current?.(node.offsetHeight));
    watch.observe(node);
    observer.current = watch;
    report.current(node.offsetHeight);
  }, []);
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      data-slot="bulk-bar"
      ref={measure}
      className={cn(
        "fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 md:inset-x-auto md:bottom-6 md:left-1/2 md:-translate-x-1/2",
        className,
      )}
    >
      <div className="border-border bg-popover text-popover-foreground flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-lg">
        <span className="px-2 text-sm font-medium tabular-nums">
          {count} {noun}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          aria-label="Clear selection"
          className="ml-auto"
        >
          <XIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}
