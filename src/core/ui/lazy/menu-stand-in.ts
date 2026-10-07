import type { PointerEvent } from "react";

/**
 * The press handlers of a lazily loaded menu's stand-in button (6.0: `UserMenu`, `ThemeToggle`),
 * taken from Radix's own trigger so a tap lands the same whichever of the two buttons it hits:
 *
 * - **pointerdown opens** (the primary button, no Ctrl), as Radix does: a press that goes down
 *   on the stand-in and comes up on the real trigger (the code arrived in between) still opens
 *   the menu (CI run 37575602126);
 * - **its default is prevented**, as Radix does when it opens, so the press does not move focus
 *   away from the menu it is opening;
 * - **a click opens too**, for the keyboard (Enter and Space click a button).
 */
export function menuStandInPress(open: () => void): {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onClick: () => void;
} {
  return {
    onPointerDown: (event) => {
      if (event.button !== 0 || event.ctrlKey) return;
      event.preventDefault();
      open();
    },
    onClick: open,
  };
}
