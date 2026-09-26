import { BellIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/core/ui/primitives/button";
import { ThemeToggle } from "@/core/ui/theme/theme-toggle";

import { Brand } from "./brand";
import { UserMenu } from "./user-menu";
import type { ShellViewer } from "./viewer";

/**
 * The top bar.
 *
 * **Desktop** (`md` up): sticky, with the bell, the theme toggle and the account menu. The
 * sidebar carries the brand, so it isn't repeated here.
 *
 * **Phone**: a 48px brand row that **slides away on scroll down and returns on scroll up**
 * (ARCHITECTURE §14.1, task 1.5). The page title bar (`PageHeader`) sticks directly beneath it
 * and takes the top edge when it goes, so scrolling a list gives its 48px back to content.
 * `MobileChrome` sets `data-chrome` on `<html>`; `globals.css` moves `--app-chrome-h`. The bell
 * is not repeated here on a phone: it is either in the bottom bar (Staff) or in the title bar
 * (Owner and Admin), where it can't scroll out of reach.
 *
 * The hamburger and its drawer are gone. Every role now has a bottom bar instead.
 */
export function TopBar({
  viewer,
  home,
  logoutItem,
}: {
  viewer: ShellViewer;
  home: string;
  logoutItem?: ReactNode;
}) {
  return (
    <header
      data-slot="top-bar"
      className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-12 items-center gap-2 border-b px-3 backdrop-blur transition-transform duration-200 sm:px-4 md:h-14"
    >
      <Brand href={home} className="md:hidden" />
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" asChild className="hidden md:inline-flex">
          <Link href="/notifications" aria-label="Notifications">
            <BellIcon aria-hidden />
          </Link>
        </Button>
        <div className="hidden md:block">
          <ThemeToggle />
        </div>
        <UserMenu viewer={viewer} logoutItem={logoutItem} />
      </div>
    </header>
  );
}
