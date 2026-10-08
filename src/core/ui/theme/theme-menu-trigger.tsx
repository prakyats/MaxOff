"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/core/ui/primitives/button";

/**
 * The theme menu's icon button, drawn the same by the menu (as Radix's trigger) and by its
 * stand-in until the menu's code has arrived (`ThemeToggle`, 6.0). Both icons render; CSS shows
 * one, so server and client markup match.
 */
export function ThemeMenuTrigger(props: ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" size="icon" aria-label="Change theme" {...props}>
      <SunIcon className="dark:hidden" aria-hidden />
      <MoonIcon className="hidden dark:block" aria-hidden />
    </Button>
  );
}
