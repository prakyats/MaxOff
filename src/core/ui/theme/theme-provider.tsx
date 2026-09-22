"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Light / dark theme, stored by next-themes in localStorage and applied as the `dark`
 * class on <html> (see the `@custom-variant dark` rule in globals.css).
 * Default is the system preference; the toggle in the shell overrides it.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
