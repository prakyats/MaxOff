"use client";

import { CheckIcon } from "lucide-react";
import { useTheme } from "next-themes";
import type { RefObject } from "react";

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
        <div role="radiogroup" aria-label="Appearance" className="flex flex-col px-2">
          {THEME_OPTIONS.map(({ value, label, Icon }) => {
            const chosen = current === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={chosen}
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
                  {value === "system" ? (
                    <span className="text-muted-foreground block text-sm">
                      Follows this device&rsquo;s setting
                    </span>
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
