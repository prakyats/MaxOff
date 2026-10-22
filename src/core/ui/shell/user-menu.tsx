"use client";

import { useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";
import { menuStandInPress } from "@/core/ui/lazy/menu-stand-in";
import { useIsDesktop } from "@/core/ui/viewport/use-desktop";

import type { AccountMenuProps } from "./account-menu";
import { AccountMenuTrigger } from "./account-menu-trigger";

const loadAccountMenu = () => import("./account-menu").then((module) => module.AccountMenu);

/**
 * The account menu in the top bar, **loaded after the page** (6.0, the first-load diet;
 * ARCHITECTURE §19): its dropdown (Radix menu and its positioning) draws nothing until it is
 * opened, so it stays out of every screen's first-load JavaScript. Until it arrives the same
 * avatar button stands in; a tap on it then opens the menu as soon as the code is there.
 *
 * **Laptop only:** a phone has no top bar (L4), so once the page knows it is on a phone the menu
 * is not drawn at all (no hidden second avatar, and its code is never asked for); until then the
 * top bar's own `md:` class decides, so a laptop's header never moves on hydration.
 */
export function UserMenu(props: Omit<AccountMenuProps, "defaultOpen">) {
  const [wanted, setWanted] = useState(false);
  const desktop = useIsDesktop();
  if (desktop === false) return null;
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
          // The press as Radix's trigger takes it (opens on pointerdown, its default prevented;
          // a click for the keyboard): `menuStandInPress`.
          {...menuStandInPress(() => setWanted(true))}
        />
      }
    />
  );
}
