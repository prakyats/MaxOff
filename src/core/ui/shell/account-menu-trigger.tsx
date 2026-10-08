"use client";

import type { ComponentProps } from "react";

import { fileUrl } from "@/core/storage";
import { Avatar, AvatarFallback, AvatarImage } from "@/core/ui/primitives/avatar";
import { Button } from "@/core/ui/primitives/button";

import { initialsOf, type ShellViewer } from "./viewer";

/**
 * The account menu's avatar button, drawn the same by the menu (as Radix's trigger, which passes
 * its own props and ref through) and by its stand-in until the menu's code has arrived
 * (`UserMenu`, 6.0), so nothing moves when it does.
 */
export function AccountMenuTrigger({
  viewer,
  ...props
}: { viewer: ShellViewer } & ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      aria-label="Account menu"
      {...props}
    >
      <Avatar size="sm">
        {viewer.avatarFileId ? <AvatarImage src={fileUrl(viewer.avatarFileId)} alt="" /> : null}
        <AvatarFallback>{initialsOf(viewer.name)}</AvatarFallback>
      </Avatar>
    </Button>
  );
}
