"use client";

import { useEffect } from "react";

import { quietThemeChanges } from "./quiet-theme-change";

/** The theme watch (`quietThemeChanges`), loaded after the page by `ThemeProvider`. */
export function QuietThemeChanges() {
  useEffect(() => quietThemeChanges(), []);
  return null;
}
