"use client";

import { UserIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ROLE_LABELS } from "@/core/lib/role-labels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import { AccountMenuTrigger } from "./account-menu-trigger";
import type { ShellViewer } from "./viewer";

export type AccountMenuProps = {
  viewer: ShellViewer;
  logoutItem?: ReactNode;
  /** Opened at once: the trigger was tapped before this menu's code had arrived (`UserMenu`). */
  defaultOpen?: boolean;
};

/**
 * Avatar button with the viewer's name, role and job title and a Profile link. An optional
 * `logoutItem` is rendered by the app layout (`core/auth` owns the action), so the design
 * system never depends on auth. Loaded after the page by `UserMenu` (6.0); its trigger is
 * `AccountMenuTrigger`, which the stand-in draws too.
 */
export function AccountMenu({ viewer, logoutItem, defaultOpen = false }: AccountMenuProps) {
  const subtitle = viewer.jobTitle
    ? `${ROLE_LABELS[viewer.role]} · ${viewer.jobTitle}`
    : ROLE_LABELS[viewer.role];

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <AccountMenuTrigger viewer={viewer} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-foreground truncate font-medium">{viewer.name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">{subtitle}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/me">
            <UserIcon aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
        {logoutItem}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
