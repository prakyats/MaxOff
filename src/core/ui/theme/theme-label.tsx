"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * The theme in words — "Dark", or "System" with what it currently resolves to.
 *
 * The chosen theme is only known in the browser (next-themes reads it from storage after
 * hydration), so this renders nothing on the server and fills in on mount. Without the mounted
 * guard the server would have to guess, and React would log a hydration mismatch.
 */
/** Never changes, so the store never notifies: the snapshots alone say server or browser. */
const neverChanges = () => () => undefined;

export function ThemeLabel() {
  const { theme, resolvedTheme } = useTheme();
  // The idiomatic "am I hydrated yet" check. A `setState` in an effect would do the same, but
  // the project forbids that (`react-hooks/set-state-in-effect`, learned in 1.3).
  const hydrated = useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );

  if (!hydrated) return null;

  const chosen = theme ?? "system";
  if (chosen === "system") {
    return <>System ({LABELS[resolvedTheme ?? "light"] ?? "Light"})</>;
  }
  return <>{LABELS[chosen] ?? "Light"}</>;
}
