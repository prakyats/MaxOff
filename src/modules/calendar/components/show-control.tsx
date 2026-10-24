"use client";

import { useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";
import { menuStandInPress } from "@/core/ui/lazy/menu-stand-in";

import type { CalendarShow } from "../domain/show";
import { ShowTrigger } from "./show-trigger";

const loadShowMenu = () => import("./show-menu").then((module) => module.ShowMenu);

/**
 * **All ▾** beside Filters (v1.8, owner 23 Oct): the laptop toolbar's, and the phone header's
 * (option A); it replaced the All · Tasks · Client work segmented switch on both. The menu is
 * **loaded after the page** (ARCHITECTURE §19), the same way as the account and theme menus:
 * until its code arrives the same button stands in, and a press on it opens the menu as soon as
 * it is there (`menuStandInPress`).
 */
export function ShowControl({
  show,
  onShow,
  className,
}: {
  show: CalendarShow;
  onShow: (show: CalendarShow) => void;
  /** The phone header's 44 px button (option A). */
  className?: string;
}) {
  const [wanted, setWanted] = useState(false);
  return (
    <AfterPage
      load={loadShowMenu}
      props={{ show, onShow, defaultOpen: wanted, ...(className ? { className } : {}) }}
      fallback={
        <ShowTrigger
          show={show}
          className={className}
          aria-haspopup="menu"
          aria-expanded={false}
          data-state="closed"
          {...menuStandInPress(() => setWanted(true))}
        />
      }
    />
  );
}
