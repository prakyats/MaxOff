import { CircleHelpIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "./brand";
import { type NavItem } from "./nav";
import { NavList } from "./nav-list";

/** Desktop sidebar for every role (hidden below `md`; the Crew's is 5B decision 5). */
export function Sidebar({
  home,
  items,
  badges,
  footer,
}: {
  home: string;
  items: readonly NavItem[];
  /** Each item's count by key, streamed by the shell (4C). */
  badges?: Readonly<Partial<Record<string, ReactNode>>>;
  footer?: ReactNode;
}) {
  return (
    <aside
      data-slot="sidebar"
      className="border-sidebar-border bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r md:flex"
    >
      <div className="flex h-14 items-center px-4">
        <Brand href={home} />
      </div>
      <NavList
        items={items}
        {...(badges ? { badges } : {})}
        className="flex-1 overflow-y-auto px-3 py-2"
      />
      {/* N2 (v1.8 V4): Help, the guide for the reader's role, at the foot for every role. */}
      <div className="border-sidebar-border flex flex-col gap-2 border-t p-3">
        <Link
          href="/me/guide"
          data-slot="sidebar-help"
          className="pressable-row text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors outline-none focus-visible:ring-2"
        >
          <CircleHelpIcon aria-hidden className="size-4 shrink-0" />
          Help
        </Link>
        {footer}
      </div>
    </aside>
  );
}
