import { BellIcon } from "lucide-react";
import Link from "next/link";

/**
 * The notification bell inside the mobile page title bar (task 1.5).
 *
 * Owner and Admin have no Alerts destination in their bottom bar, and the brand bar that used
 * to carry the bell slides away as you scroll — so notifications would have ended up behind a
 * scroll position. The bell lives in the title bar instead, which is always on screen.
 *
 * `AppShell` sets `data-alerts` on the shell: when the bottom bar already has Alerts (Staff),
 * `globals.css` hides this, because a second bell two inches above the first is noise. The live
 * unread count replaces the static dot when `core/notifications` lands (5.1).
 */
export function HeaderBell() {
  return (
    <Link
      href="/notifications"
      data-slot="header-bell"
      aria-label="Notifications"
      className="text-muted-foreground active:bg-muted relative flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden"
    >
      <BellIcon className="size-5" aria-hidden />
    </Link>
  );
}
