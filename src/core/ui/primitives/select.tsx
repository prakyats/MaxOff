"use client";

import * as React from "react";
import { cn } from "cn";
import { Select as SelectPrimitive } from "radix-ui";
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react";

import { PHONE_QUERY } from "@/core/ui/motion/nav-types";
import { useOverlayOpenState } from "@/core/ui/overlay/overlay-history";
import { useSwipeDismiss } from "@/core/ui/overlay/swipe-dismiss";
import { MODAL_HANDLE } from "@/core/ui/primitives/modal-surface";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/core/ui/primitives/sheet";

/**
 * The select (ARCHITECTURE §14.1, owner decision 2026-09-27, 3B review):
 * - **Below 768px it opens a nested bottom sheet**, its own overlay layer (so it works inside a
 *   sheet or a dialog): titled with the field's label, 48px rows, a ✓ on the current value; a
 *   tap picks and closes; swipe-down, the ✕, the backdrop and back close it without changing
 *   anything (§14.2 a).
 * - **From 768px up it is a popper below the trigger, at the trigger's width**, never
 *   item-aligned (an item-aligned list jumps over the trigger and covers the label).
 *
 * Callers keep the one composition — `Select > SelectTrigger > SelectValue` and
 * `SelectContent > SelectItem` — and get both. Radix keeps the value, the trigger's text, the
 * keyboard and the hidden form input on every width; the sheet only replaces the open list.
 * Whether a tap opens the sheet is read at the moment of opening (the phone query), so the
 * server render and hydration never depend on the width.
 */

type SelectState = {
  value: string | undefined;
  sheetOpen: boolean;
  closeSheet: () => void;
  pick: (value: string) => void;
  title: string;
  setTrigger: (node: HTMLButtonElement | null) => void;
  expanded: boolean;
};

const SelectStateContext = React.createContext<SelectState | null>(null);
/** True inside the phone sheet: an item renders as a sheet row there. */
const SheetListContext = React.createContext(false);

/** What a label-carrying element looks like to `labelOf`; a real button satisfies it. */
export interface Labelled {
  getAttribute(name: string): string | null;
  labels?: ArrayLike<{ textContent: string | null }> | null;
  ownerDocument: { getElementById(id: string): { textContent: string | null } | null };
}

/**
 * The sheet's title: the field's label, as assistive tech names the trigger — `aria-label`,
 * then `aria-labelledby`, then a `<label for>` (every `FormField`). Pure, so it is unit tested.
 */
export function labelOf(trigger: Labelled | null, fallback = "Choose"): string {
  if (!trigger) return fallback;
  const aria = trigger.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const labelledBy = trigger.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => trigger.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  const label = trigger.labels?.[0]?.textContent?.trim();
  return label || fallback;
}

/**
 * An open list is a layer: back (or the phone's back gesture) closes it before anything under
 * it (ARCHITECTURE §14.2 a) — see `core/ui/overlay/overlay-history`. On a desktop the Radix list
 * registers here; on a phone the sheet registers through the `Sheet` root.
 * `open` / `defaultOpen` drive the desktop list.
 */
function Select({
  open,
  defaultOpen,
  onOpenChange,
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [isOpen, setOpen] = useOverlayOpenState({ open, defaultOpen, onOpenChange });
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [title, setTitle] = React.useState("Choose");
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const current = value !== undefined ? value : uncontrolled;

  const change = React.useCallback(
    (next: string) => {
      if (value === undefined) setUncontrolled(next);
      onValueChange?.(next);
    },
    [value, onValueChange],
  );

  const openList = React.useCallback(
    (next: boolean) => {
      if (next && window.matchMedia(PHONE_QUERY).matches) {
        setTitle(labelOf(trigger.current));
        setSheetOpen(true);
        return;
      }
      setOpen(next);
    },
    [setOpen],
  );

  const state = React.useMemo<SelectState>(
    () => ({
      value: current,
      sheetOpen,
      closeSheet: () => setSheetOpen(false),
      // The value first, then the close, as Radix does: a caller that writes the URL from the
      // change (`DataTable`) backs out the sheet's entry itself (`closeOverlaysThen`). The chosen
      // row again is no change, so no callback (as in Radix).
      pick: (next) => {
        if (next !== current) change(next);
        setSheetOpen(false);
      },
      title,
      setTrigger: (node) => {
        trigger.current = node;
      },
      expanded: isOpen || sheetOpen,
    }),
    [current, sheetOpen, change, title, isOpen],
  );

  return (
    <SelectStateContext.Provider value={state}>
      <SelectPrimitive.Root
        data-slot="select"
        open={isOpen}
        onOpenChange={openList}
        // Always controlled here ("" is Radix's "nothing chosen"), so a pick on the phone sheet
        // and one in the desktop list move the same value.
        value={current ?? ""}
        onValueChange={change}
        {...props}
      />
    </SelectStateContext.Provider>
  );
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  const state = React.useContext(SelectStateContext);
  const setTrigger = state?.setTrigger;
  const composedRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      setTrigger?.(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [setTrigger, ref],
  );
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      ref={composedRef}
      aria-expanded={state?.expanded ?? false}
      className={cn(
        "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 pressable-row flex w-fit items-center justify-between gap-1.5 rounded-lg border bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/**
 * The open list: the popper from `md` up, and the phone sheet. Both hold the same items; the
 * closed Radix list stays mounted (off-document) on a phone too, which is how the trigger shows
 * the chosen item's text.
 */
function SelectContent({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Content>, "position">) {
  return (
    <>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          data-slot="select-content"
          position="popper"
          side="bottom"
          align="start"
          sideOffset={4}
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 relative z-50 max-h-(--radix-select-content-available-height) w-(--radix-select-trigger-width) origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg shadow-md ring-1 duration-100",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport className="h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width) scroll-my-1 p-1">
            {children}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
      <SelectSheet>{children}</SelectSheet>
    </>
  );
}

/**
 * The phone list: a bottom sheet over whatever is open (its own layer, §14.2 a). It closes
 * without an exit animation, so a tap lands the choice at once and the layer under it is the
 * only dialog left.
 */
function SelectSheet({ children }: { children: React.ReactNode }) {
  const state = React.useContext(SelectStateContext);
  const list = React.useRef<HTMLDivElement | null>(null);
  const [listScrolls, setListScrolls] = React.useState(false);
  const closeSheet = state?.closeSheet;
  const swipe = useSwipeDismiss(() => closeSheet?.());
  const open = state?.sheetOpen ?? false;

  // The sheet takes every touch drag for the swipe (`touch-none`: a pan the browser claimed
  // would cancel the pointer). A list that cannot scroll does too; one that can keeps vertical
  // panning for its own scroll, and the swipe then starts from the handle and the title. Measured
  // when the list mounts (the sheet's portal mounts a render after `open`).
  const measureList = React.useCallback((node: HTMLDivElement | null) => {
    list.current = node;
    if (node) setListScrolls(node.scrollHeight > node.clientHeight);
  }, []);

  if (!state) return null;
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : state.closeSheet())}>
      <SheetContent
        side="bottom"
        data-slot="select-sheet"
        aria-describedby={undefined}
        overlayClassName="data-closed:animate-none"
        className="max-h-[85dvh] touch-none gap-0 rounded-t-2xl pb-[var(--app-safe-bottom)] data-closed:animate-none"
        onOpenAutoFocus={(event) => {
          // Focus the chosen row (or the first), not the ✕: the list is what the sheet is for.
          event.preventDefault();
          const rows = list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
          const chosen = list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
          (chosen ?? rows?.[0])?.focus();
        }}
        {...swipe}
      >
        <div aria-hidden className={MODAL_HANDLE} />
        <SheetHeader className="pt-5 pr-14 pb-2">
          <SheetTitle>{state.title}</SheetTitle>
        </SheetHeader>
        <div
          ref={measureList}
          role="listbox"
          aria-label={state.title}
          data-swipe-scroll
          className={cn(
            "flex flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pb-4",
            listScrolls ? "touch-pan-y" : "touch-none",
          )}
        >
          <SheetListContext.Provider value={true}>{children}</SheetListContext.Provider>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SelectItem({
  className,
  children,
  value,
  disabled,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const inSheet = React.useContext(SheetListContext);
  const state = React.useContext(SelectStateContext);
  if (inSheet && state) {
    const selected = state.value === value;
    return (
      <button
        type="button"
        role="option"
        aria-selected={selected}
        disabled={disabled}
        data-slot="select-sheet-item"
        className="pressable-row focus-visible:ring-ring flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-base outline-none focus-visible:ring-2 disabled:opacity-50"
        onClick={() => state.pick(value)}
      >
        <span className="min-w-0 flex-1 break-words">{children}</span>
        <CheckIcon
          aria-hidden
          data-slot="select-sheet-check"
          className={cn("size-5 shrink-0", !selected && "invisible")}
        />
      </button>
    );
  }
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={value}
      {...(disabled === undefined ? {} : { disabled })}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground pressable-row relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
