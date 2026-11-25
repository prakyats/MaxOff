"use client";

import { useEffect } from "react";

import { quietThemeChanges } from "./quiet-theme-change";

/**
 * The theme watch (`quietThemeChanges`) for the signed-out screens (final review S8): they follow
 * the device's dark mode too (System, with no stored choice), and their inputs fade their `dark:`
 * colours, so a flip there ran those transitions while the page around them snapped. The
 * signed-in shell starts the same watch in `PwaAfterPage`. Mounted by the signed-out layout;
 * renders nothing.
 */
export function QuietThemeWatch(): null {
  useEffect(() => quietThemeChanges(), []);
  return null;
}
