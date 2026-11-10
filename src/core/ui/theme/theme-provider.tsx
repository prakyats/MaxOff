"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Light / dark theme, stored by next-themes in localStorage and applied as the `dark`
 * class on <html> (see the `@custom-variant dark` rule in globals.css).
 * Default is the system preference (next-themes' own defaults: `enableSystem`, then
 * `defaultTheme` "system"); the toggle in the shell overrides it.
 *
 * No transitions while the theme changes, and only then: `quietThemeChanges`, started by the
 * signed-in shell's after-page helpers (`PwaAfterPage`; the theme menu and the Appearance sheet
 * are the shell's). next-themes' `disableTransitionOnChange` also ran on mount, restyling the
 * whole page twice for nothing (v2.0 X3 (d)).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <NextThemesProvider attribute="class">{children}</NextThemesProvider>;
}
