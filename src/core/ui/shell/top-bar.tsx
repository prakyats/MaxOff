import { BellIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/core/ui/primitives/button";
import { ThemeToggle } from "@/core/ui/theme/theme-toggle";

import { Brand } from "./brand";
import { UserMenu } from "./user-menu";
import type { ShellViewer } from "./viewer";

/**
 * Sticky top bar. `leading` holds the mobile menu button for CEO / Admin. The bell links to
 * the notification history until `core/notifications` replaces it with the live <Bell> (5.1).
 */
export function TopBar({
  viewer,
  home,
  leading,
}: {
  viewer: ShellViewer;
  home: string;
  leading?: ReactNode;
}) {
  return (
    <header
      data-slot="top-bar"
      className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur sm:px-4"
    >
      {leading}
      <Brand href={home} className="md:hidden" />
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/notifications" aria-label="Notifications">
            <BellIcon aria-hidden />
          </Link>
        </Button>
        <ThemeToggle />
        <UserMenu viewer={viewer} />
      </div>
    </header>
  );
}
