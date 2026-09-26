"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

import { THEME_COLORS } from "./theme-color";

/**
 * Keeps `<meta name="theme-color">` in step with the theme the user actually has (task 1.5).
 *
 * The viewport export renders two theme-color metas keyed on `prefers-color-scheme`, which
 * follows the **operating system**. That is wrong the moment someone picks Light or Dark
 * explicitly in the app: a phone in Light with the app set to Dark kept a white status-bar band
 * above a dark screen.
 *
 * `resolvedTheme` already folds "system" down to light or dark, so writing it to every
 * theme-color meta — and dropping their `media` attributes, so the OS query can no longer win —
 * is correct in all three cases. `THEME_COLOR_SCRIPT` does the same before first paint.
 */
export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = THEME_COLORS[resolvedTheme];
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length === 0) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = color;
      document.head.appendChild(meta);
      return;
    }
    for (const meta of metas) {
      meta.setAttribute("content", color);
      meta.removeAttribute("media");
    }
  }, [resolvedTheme]);

  return null;
}
