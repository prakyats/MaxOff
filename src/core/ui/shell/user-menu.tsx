"use client";

import { UserIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/core/ui/primitives/avatar";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import { initialsOf, ROLE_LABELS, type ShellViewer } from "./viewer";

/**
 * Avatar button with the viewer's name, role and job title, a Profile link and Log out.
 * `logoutItem` is rendered by the app layout (`core/auth` owns the action), so the design
 * system never depends on auth.
 */
export function UserMenu({ viewer, logoutItem }: { viewer: ShellViewer; logoutItem?: ReactNode }) {
  const subtitle = viewer.jobTitle
    ? `${ROLE_LABELS[viewer.role]} · ${viewer.jobTitle}`
    : ROLE_LABELS[viewer.role];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar size="sm">
            <AvatarFallback>{initialsOf(viewer.name)}</AvatarFallback>
          </Avatar>
        </Button>
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
