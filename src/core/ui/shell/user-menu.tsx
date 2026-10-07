"use client";

import { useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

import type { AccountMenuProps } from "./account-menu";
import { AccountMenuTrigger } from "./account-menu-trigger";

const loadAccountMenu = () => import("./account-menu").then((module) => module.AccountMenu);

/**
 * The account menu in the top bar, **loaded after the page** (6.0, the first-load diet;
 * ARCHITECTURE §19): its dropdown (Radix menu and its positioning) draws nothing until it is
 * opened, so it stays out of every screen's first-load JavaScript. Until it arrives the same
 * avatar button stands in; a tap on it then opens the menu as soon as the code is there.
 */
export function UserMenu(props: Omit<AccountMenuProps, "defaultOpen">) {
  const [wanted, setWanted] = useState(false);
  return (
    <AfterPage
      load={loadAccountMenu}
      props={{ ...props, defaultOpen: wanted }}
      fallback={
        <AccountMenuTrigger
          viewer={props.viewer}
          aria-haspopup="menu"
          aria-expanded={false}
          data-state="closed"
          // Radix opens a menu on pointerdown: the stand-in hears the same, so a press that
          // lands just as the menu's code arrives (the button swapped between the press and
          // its click) still opens it. The click covers the keyboard (Enter, Space).
          onPointerDown={() => setWanted(true)}
          onClick={() => setWanted(true)}
        />
      }
    />
  );
}
