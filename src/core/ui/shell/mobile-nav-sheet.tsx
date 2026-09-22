"use client";

import { MenuIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/core/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";

import { type NavItem } from "./nav";
import { NavList } from "./nav-list";

/** Hamburger button that opens the CEO / Admin navigation in a side sheet on small screens. */
export function MobileNavSheet({
  items,
  footer,
}: {
  items: readonly NavItem[];
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation" className="md:hidden">
          <MenuIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="bg-sidebar text-sidebar-foreground w-72 p-0">
        <SheetHeader className="border-sidebar-border border-b">
          <SheetTitle>MaxOff</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
        </SheetHeader>
        <NavList items={items} onNavigate={() => setOpen(false)} className="flex-1 px-3 py-2" />
        {footer ? <div className="border-sidebar-border border-t p-3">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
