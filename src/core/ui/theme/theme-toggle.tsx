"use client";

import { useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

import { ThemeMenuTrigger } from "./theme-menu-trigger";

const loadThemeMenu = () => import("./theme-menu").then((module) => module.ThemeMenu);

/**
 * Icon button that opens a Light / Dark / System menu. Safe to render on the server. The menu
 * itself is **loaded after the page** (6.0, the first-load diet; ARCHITECTURE §19): the top bar,
 * the More sheet and Me draw this, and the dropdown draws nothing until it is opened. Until it
 * arrives the same button stands in; a tap on it opens the menu as soon as the code is there.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [wanted, setWanted] = useState(false);
  return (
    <AfterPage
      load={loadThemeMenu}
      props={{ ...(className ? { className } : {}), defaultOpen: wanted }}
      fallback={
        <ThemeMenuTrigger
          className={className}
          aria-haspopup="menu"
          aria-expanded={false}
          data-state="closed"
          onClick={() => setWanted(true)}
        />
      }
    />
  );
}
