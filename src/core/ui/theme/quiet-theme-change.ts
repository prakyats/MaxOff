/**
 * No transitions while the theme changes (what next-themes' `disableTransitionOnChange` did),
 * **only when it really changes** (v2.0 X3 (d)). next-themes applies the theme again on mount,
 * although its head script already did; with that option every application inserted a
 * "transition: none" style, forced the whole page's style (`getComputedStyle(body)`) and removed
 * it a moment later: two full-document restyles inside hydration, ≈ 40 ms each at CPU ×4 on a
 * phone, for no change at all. Here `<html>`'s class is watched instead: a change between light
 * and dark (the theme menu, the Appearance sheet, the system's dark mode) gets the same
 * treatment, in the same order; a re-application of the same theme gets nothing.
 */

/** Marks `<html>` while the watch is on (the theme spec waits for it). */
export const QUIET_THEME_ATTRIBUTE = "data-theme-quiet";

/**
 * Watches `<html>`'s class; returns the disconnect. The observer's callback runs as a microtask
 * right after next-themes changes the class, before the browser restyles, so the restyle that
 * shows the new theme runs with transitions off (the style is removed a moment later).
 */
export function quietThemeChanges(root: HTMLElement = document.documentElement): () => void {
  const dark = () => root.classList.contains("dark");
  let was = dark();
  const observer = new MutationObserver(() => {
    if (dark() === was) return;
    was = !was;
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.append(style);
    window.getComputedStyle(document.body);
    window.setTimeout(() => style.remove(), 1);
  });
  observer.observe(root, { attributeFilter: ["class"] });
  root.setAttribute(QUIET_THEME_ATTRIBUTE, "");
  return () => {
    observer.disconnect();
    root.removeAttribute(QUIET_THEME_ATTRIBUTE);
  };
}
