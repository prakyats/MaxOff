"use client";

import { MoreHorizontalIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/core/ui/primitives/button";

/**
 * The project's ⋯ button, drawn the same by the menu (as Radix's trigger,
 * `project-menu-dropdown.tsx`) and by its stand-in until the menu's code has arrived
 * (`ProjectMenu`; ARCHITECTURE §19, the pattern of `ThemeMenuTrigger`).
 */
export function ProjectMenuTrigger({
  name,
  ...props
}: ComponentProps<typeof Button> & { name: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Actions for ${name}`}
      className="size-11 md:size-8"
      {...props}
      // After the spread: Radix's trigger passes its own `data-slot`, and this one is the button's.
      data-slot="project-menu"
    >
      <MoreHorizontalIcon aria-hidden />
    </Button>
  );
}
