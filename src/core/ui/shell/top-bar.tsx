import { BellIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/core/ui/primitives/button";
import { ThemeToggle } from "@/core/ui/theme/theme-toggle";

import { UserMenu } from "./user-menu";
import type { ShellViewer } from "./viewer";

/**
 * The laptop's top bar (`md` up): sticky, 56 px (FINAL 6, V5b major change 9: slim, no empty
 * band), with the bell (the outline glyph at 20 px, its count a pill offset top-right outside it,
 * `NavBadgeMark` place `topbar`), the theme toggle and the account menu.
 * The sidebar carries the brand, so it isn't repeated here.
 *
 * **A phone has no top bar** (L4, UX review 2026-10-21: a logo bar above the title bar took ~90 px
 * of every screen). Its one header bar is the page's own title bar (`PageHeader`): back or title,
 * the screen's ⋯ and the bell. Home is the bottom bar's first tab, and Me (the account menu's one
 * entry) is in the bottom bar or the More sheet, so nothing here is lost on a phone.
 */
export function TopBar({
  viewer,
  logoutItem,
  bellCount,
}: {
  viewer: ShellViewer;
  logoutItem?: ReactNode;
  /** The unread count on the bell (5.1), streamed by the shell like the nav counts. */
  bellCount?: ReactNode;
}) {
  return (
    <header
      data-slot="top-bar"
      className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 hidden h-14 items-center gap-2 border-b px-4 backdrop-blur md:flex"
    >
      {/* Each control is its own 44 px hit area, 8 px apart, so the bell's count never touches
          the theme toggle beside it (owner, #89 comment 6338991185). */}
      <div data-slot="top-bar-controls" className="ml-auto flex items-center gap-2 *:size-11">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/notifications" data-slot="top-bar-bell" className="relative">
            {/* The count's centre sits on the 20 px glyph's top-right corner (`NavBadgeMark`). */}
            <span data-slot="top-bar-bell-glyph" className="relative flex size-5">
              <BellIcon aria-hidden className="size-5" />
              {bellCount}
            </span>
            <span className="sr-only">Notifications</span>
          </Link>
        </Button>
        <ThemeToggle />
        <UserMenu viewer={viewer} logoutItem={logoutItem} />
      </div>
    </header>
  );
}
