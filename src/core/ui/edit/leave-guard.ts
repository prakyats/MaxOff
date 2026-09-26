/**
 * Which clicks leave the page (task 2.9, ARCHITECTURE §14.2 f). While an editor holds unsaved
 * changes, a click that would navigate within the app is held and "Discard changes?" asked
 * first. Pure, so the filter is unit-tested; `use-leave-guard.ts` wires it to the window.
 */

export interface ClickLike {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface AnchorLike {
  href: string;
  target: string;
  hasAttribute(name: string): boolean;
}

/**
 * True when the click is an in-app navigation that should wait for "Discard changes?". A
 * modified click, another button, a new-tab target, a download or another origin leaves this
 * page intact (or is not ours to hold), so it goes through.
 */
export function isLeavingClick(event: ClickLike, anchor: AnchorLike, origin: string): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  try {
    return new URL(anchor.href, origin).origin === origin;
  } catch {
    return false;
  }
}
