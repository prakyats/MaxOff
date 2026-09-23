import type { ReactNode } from "react";

import { Brand } from "./brand";
import { type NavItem } from "./nav";
import { NavList } from "./nav-list";

/** Desktop sidebar for Owner and Admin (hidden below `md`; the top bar opens a sheet instead). */
export function Sidebar({
  home,
  items,
  footer,
}: {
  home: string;
  items: readonly NavItem[];
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
      <NavList items={items} className="flex-1 overflow-y-auto px-3 py-2" />
      {footer ? <div className="border-sidebar-border border-t p-3">{footer}</div> : null}
    </aside>
  );
}
