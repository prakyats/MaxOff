"use client";

import { CircleUserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

import { cn } from "@/core/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";
import { ThemeLabel } from "@/core/ui/theme/theme-label";
import { ThemeToggle } from "@/core/ui/theme/theme-toggle";

import { isActivePath, type NavItem, PROFILE_NAV_ITEM } from "./nav";
import { NAV_ICONS } from "./nav-icons";

const ROW =
  "flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm outline-none transition-colors active:bg-muted focus-visible:ring-ring focus-visible:ring-2";

/**
 * The fifth slot of the bottom bar for Owner and Admin: the destinations that didn't make the
 * primary four, plus profile, appearance and **Log out** (ARCHITECTURE §14.1).
 *
 * Log out is here rather than only in the account menu because it is a recorded attendance
 * action (WORKFLOWS §1 `session_logout` writes the time), so it must not sit behind a brand bar
 * that has scrolled away. Staff never see this sheet: their five destinations are the whole app,
 * and their Log out is on Me.
 */
export function MoreSheet({
  items,
  logoutItem,
  trigger,
}: {
  items: readonly NavItem[];
  /** `core/auth` owns the action; the app layout passes it in, so `core/ui` never imports auth. */
  logoutItem?: ReactNode;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        data-slot="more-sheet"
        className="max-h-[85dvh] gap-2 overflow-y-auto rounded-t-2xl pb-[calc(1rem+var(--app-safe-bottom))]"
      >
        <div
          aria-hidden
          className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
        />
        <SheetHeader className="pt-3 pb-1">
          <SheetTitle>More</SheetTitle>
          <SheetDescription className="sr-only">
            The rest of the navigation, your profile and log out
          </SheetDescription>
        </SheetHeader>

        <nav aria-label="More" className="flex flex-col gap-0.5 px-2">
          {items.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                data-nav={item.key}
                onClick={close}
                aria-current={active ? "page" : undefined}
                className={cn(ROW, active && "bg-muted font-medium")}
              >
                <Icon className={cn("size-5 shrink-0", active && "text-brand")} aria-hidden />
                <span className="flex-1">{item.label}</span>
                {/* The same count the More cell adds up, so you can see which row it came from. */}
                {item.badge && item.badge > 0 ? (
                  <span
                    data-slot="nav-badge"
                    className="bg-brand text-brand-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold"
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-border mx-2 my-1 border-t" />

        <div className="flex flex-col gap-0.5 px-2">
          <Link
            href={PROFILE_NAV_ITEM.href}
            data-nav={PROFILE_NAV_ITEM.key}
            onClick={close}
            aria-current={isActivePath(pathname, PROFILE_NAV_ITEM.href) ? "page" : undefined}
            className={cn(
              ROW,
              isActivePath(pathname, PROFILE_NAV_ITEM.href) && "bg-muted font-medium",
            )}
          >
            <CircleUserIcon className="size-5 shrink-0" aria-hidden />
            {PROFILE_NAV_ITEM.label}
          </Link>
          <div className={cn(ROW, "justify-between active:bg-transparent")}>
            {/* The row states the current mode: an icon alone makes you tap to find out. */}
            <span className="flex-1">
              Appearance
              <span className="text-muted-foreground">
                {" · "}
                <ThemeLabel />
              </span>
            </span>
            <ThemeToggle />
          </div>
          {/* Log out closes the sheet; its confirmation is owned above the shell and opens over
              the page, not over a sheet that is still sitting there. */}
          <div onClick={close}>{logoutItem}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
