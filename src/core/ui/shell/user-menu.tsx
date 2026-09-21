"use client";

import { LogOutIcon, UserIcon } from "lucide-react";
import Link from "next/link";

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

/** Avatar button with the viewer's name, role and job title, a Profile link and Log out. */
export function UserMenu({ viewer }: { viewer: ShellViewer }) {
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
        {/* Wired to core/auth in task 1.2. */}
        <DropdownMenuItem disabled>
          <LogOutIcon aria-hidden />
          Log out
          <span className="text-muted-foreground ml-auto text-xs">1.2</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
