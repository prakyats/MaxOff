"use client";

import { CheckIcon } from "lucide-react";
import { useTheme } from "next-themes";
import type { KeyboardEvent, RefObject } from "react";

import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";

import { THEME_OPTIONS } from "./theme-options";

/**
 * Appearance on a phone (v2.0 X1b, owner bug 2026-11-05: the Light / Dark / System dropdown,
 * opened inside the More sheet, flashed and closed on the phone). A bottom sheet of its own
 * instead of a menu inside a sheet: three 44 px rows, the current one ticked; a tap applies it and
 * closes the sheet; back closes it (the sheet's own layer, ARCHITECTURE §14.2). The laptop keeps
 * the top bar's menu (`ThemeToggle`). Loaded on the first tap (`AppearanceTrigger`).
 */
export function AppearanceSheet({
  open,
  onOpenChange,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button that opened it: opened by state, the sheet has no trigger of its own to return to. */
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const { theme, setTheme } = useTheme();
  const current = theme ?? "system";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-slot="appearance-sheet"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
        className="rounded-t-sheet gap-2 pb-[calc(1rem+var(--app-safe-bottom))]"
      >
        <div
          aria-hidden
          className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
        />
        <SheetHeader className="pt-3 pb-0">
          <SheetTitle>Appearance</SheetTitle>
          <SheetDescription className="sr-only">
            Light, dark or follow this device&rsquo;s setting
          </SheetDescription>
        </SheetHeader>
        {/* A radio group as a keyboard expects one (v2.0 review P1, v7.0): only the ticked row is
            in the tab order, so the sheet opens on it, and Up / Down move between the rows.
            Choosing stays on Enter, Space or a tap, because choosing closes the sheet. */}
        <div
          role="radiogroup"
          aria-label="Appearance"
          className="flex flex-col px-2"
          onKeyDown={moveBetweenRows}
        >
          {THEME_OPTIONS.map(({ value, label, hint, Icon }) => {
            const chosen = current === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={chosen}
                tabIndex={chosen ? 0 : -1}
                data-slot="appearance-option"
                data-value={value}
                className="pressable-row focus-visible:ring-ring flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-base outline-none focus-visible:ring-2"
                onClick={() => {
                  // Back over the sheet's own entry first (§14.2 e), then the choice: closed by
                  // state, the entry stayed behind and swallowed a later back press (X5+ H6).
                  // With no entry of its own the choice runs at once and the sheet closes here.
                  let applied = false;
                  closeOverlaysThen(() => {
                    applied = true;
                    setTheme(value);
                  });
                  if (applied) onOpenChange(false);
                }}
              >
                <Icon aria-hidden className="text-muted-foreground size-5 shrink-0" />
                <span className="flex-1">
                  {label}
                  {hint ? (
                    <span className="text-muted-foreground block text-sm">{hint}</span>
                  ) : null}
                </span>
                {chosen ? <CheckIcon aria-hidden className="size-5 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Up / Down (and Left / Right) move focus to the next row, wrapping; Home / End to the ends. */
function moveBetweenRows(event: KeyboardEvent<HTMLDivElement>) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (at === -1) return;
  const step: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
  let next: number | undefined;
  if (event.key in step) next = (at + step[event.key]! + rows.length) % rows.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = rows.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  rows[next]?.focus();
}
