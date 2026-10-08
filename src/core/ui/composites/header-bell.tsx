"use client";

import { BellIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { HEADER_BELL_SLOT, markLive } from "@/core/ui/navigation/attributes";
import { BellCountMark } from "@/core/ui/shell/bell-count";

/**
 * The notification bell inside the mobile page title bar (task 1.5), with the unread count
 * (task 5.1, `BellCountMark`: the layout's count, streamed).
 *
 * No role has an Alerts destination in its bottom bar (the Crew's moved here in 5B decision 1),
 * and the brand bar that used to carry the bell slides away as you scroll — so notifications
 * would have ended up behind a scroll position. The bell lives in the title bar instead, which
 * is always on screen.
 *
 * `AppShell` sets `data-alerts` on the shell: were a bottom bar to carry Alerts again,
 * `globals.css` hides this, because a second bell two inches above the first is noise.
 *
 * A client component that marks itself live (`markLive`, ARCHITECTURE §14.2 l): the title bar
 * hydrates with its streamed page, after the shell, and a tap in that gap used to fall through to
 * the browser as a full load of `/notifications` (issue #49). The head script now holds such a tap
 * until this link is live and replays it, as it does for the back control, view links and tabs.
 */
export function HeaderBell() {
  return (
    <Link
      href="/notifications"
      data-slot={HEADER_BELL_SLOT}
      ref={markLive}
      className="pressable text-muted-foreground relative flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden"
    >
      <BellIcon className="size-5" aria-hidden />
      <span className="sr-only">Notifications</span>
      <Suspense fallback={null}>
        <BellCountMark />
      </Suspense>
    </Link>
  );
}
