"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

const loadQuiet = () => import("./quiet-theme-changes").then((m) => m.QuietThemeChanges);

/**
 * Light / dark theme, stored by next-themes in localStorage and applied as the `dark`
 * class on <html> (see the `@custom-variant dark` rule in globals.css).
 * Default is the system preference (next-themes' own defaults: `enableSystem`, then
 * `defaultTheme` "system"); the toggle in the shell overrides it.
 *
 * No transitions while the theme changes, and only then (`quietThemeChanges`, loaded after the
 * page: a change is a tap away): next-themes' `disableTransitionOnChange` also ran on mount,
 * restyling the whole page twice for nothing.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class">
      {children}
      <AfterPage load={loadQuiet} props={{}} />
    </NextThemesProvider>
  );
}
