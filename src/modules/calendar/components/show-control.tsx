"use client";

import { useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";
import { menuStandInPress } from "@/core/ui/lazy/menu-stand-in";

import type { CalendarShow } from "../domain/show";
import { ShowTrigger } from "./show-trigger";

const loadShowMenu = () => import("./show-menu").then((module) => module.ShowMenu);

/**
 * The laptop's **All ▾** beside Filters (v1.8 calendar toolbar, owner 23 Oct; it replaced the
 * All · Tasks · Client work segmented switch there, the phone keeps its switch). The menu is
 * **loaded after the page** (ARCHITECTURE §19), the same way as the account and theme menus:
 * until its code arrives the same button stands in, and a press on it opens the menu as soon as
 * it is there (`menuStandInPress`).
 */
export function ShowControl({
  show,
  onShow,
}: {
  show: CalendarShow;
  onShow: (show: CalendarShow) => void;
}) {
  const [wanted, setWanted] = useState(false);
  return (
    <AfterPage
      load={loadShowMenu}
      props={{ show, onShow, defaultOpen: wanted }}
      fallback={
        <ShowTrigger
          show={show}
          aria-haspopup="menu"
          aria-expanded={false}
          data-state="closed"
          {...menuStandInPress(() => setWanted(true))}
        />
      }
    />
  );
}
