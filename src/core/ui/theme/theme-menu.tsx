"use client";

import { useTheme } from "next-themes";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import { ThemeMenuTrigger } from "./theme-menu-trigger";
import { THEME_OPTIONS } from "./theme-options";

/**
 * The Light / Dark / System menu behind `ThemeToggle`, which loads it after the page (6.0).
 * `defaultOpen`: the button was tapped before this code had arrived.
 */
export function ThemeMenu({
  className,
  defaultOpen = false,
}: {
  className?: string;
  defaultOpen?: boolean;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <ThemeMenuTrigger className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          {THEME_OPTIONS.map(({ value, label, hint, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="items-start">
              <Icon aria-hidden className="mt-0.5" />
              <span>
                {label}
                {hint ? <span className="text-muted-foreground block text-xs">{hint}</span> : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
