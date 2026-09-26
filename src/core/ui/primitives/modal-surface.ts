/**
 * Below `md` a modal is a **bottom sheet**; from `md` up it is the centred dialog
 * (ARCHITECTURE §14.1: a top-anchored dialog puts its buttons out of thumb reach on a phone).
 *
 * `dialog.tsx` and `alert-dialog.tsx` share these strings so the two can never drift apart —
 * every "Are you sure?" and every form dialog in MaxOff is one of them, so this is the single
 * place the phone behaviour of modals is decided.
 */

/** Positioning and animation for the modal surface itself. */
export const MODAL_SURFACE = [
  // Phone: docked to the bottom edge, full width, rounded at the top, scrolling inside itself
  // and clearing the home indicator.
  "fixed inset-x-0 bottom-0 z-50 grid max-h-[85dvh] w-full gap-4 overflow-y-auto rounded-t-2xl p-4 pt-5 pb-[calc(1rem+var(--app-safe-bottom))] outline-none",
  "duration-200 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-8 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-8",
  // Tablet and desktop: the centred dialog, as it was before 1.5.
  "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[calc(100dvh-4rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:p-4 md:pb-4 md:duration-100",
  "md:data-open:zoom-in-95 md:data-open:slide-in-from-bottom-0 md:data-closed:zoom-out-95 md:data-closed:slide-out-to-bottom-0",
].join(" ");

/**
 * The footer. On a phone the buttons stack full width and `flex-col-reverse` puts the primary
 * one **above** Cancel, so the thumb rests on the harmless button — §14.1: a destructive action
 * never sits under the thumb next to the primary one. There it is the sheet's own surface
 * (`bg-popover`) under a top border, clearing the home indicator. From `md` up it is the
 * dialog's last row: no band, no border, buttons right-aligned, Cancel then the action (2.9
 * review, owner's check 2026-09-26: the muted band read as a second surface).
 */
export const MODAL_FOOTER = [
  "bg-popover -mx-4 -mb-[calc(1rem+var(--app-safe-bottom))] flex flex-col-reverse gap-2 border-t p-4 pb-[calc(1rem+var(--app-safe-bottom))] *:w-full",
  "md:m-0 md:flex-row md:justify-end md:border-0 md:bg-transparent md:p-0 md:*:w-auto",
].join(" ");

/** The grab handle at the top of the sheet. Visual only on phones; the close button still closes. */
export const MODAL_HANDLE =
  "bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full md:hidden";
