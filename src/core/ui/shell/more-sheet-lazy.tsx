"use client";

import { type ComponentProps, useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

import type { MoreSheet } from "./more-sheet";

type Props = Omit<ComponentProps<typeof MoreSheet>, "defaultOpen">;

const loadMoreSheet = () => import("./more-sheet").then((module) => module.MoreSheet);

/**
 * The bottom bar's More sheet, **loaded after the page** (6.0, the first-load diet; ARCHITECTURE
 * §19): the sheet draws nothing until More is tapped, so it stays out of every screen's
 * first-load JavaScript. Until it arrives the More button itself stands in (the same element,
 * as the sheet's trigger draws it, in a `contents` wrapper that hears its tap); a tap then opens
 * the sheet as soon as the code is there.
 */
export function MoreSheetLazy(props: Props) {
  const [wanted, setWanted] = useState(false);
  return (
    <AfterPage
      load={loadMoreSheet}
      props={{ ...props, defaultOpen: wanted }}
      fallback={
        // pressable: none (not a control: it hears the More button's own tap, the trigger inside)
        <span className="contents" onClick={() => setWanted(true)}>
          {props.trigger}
        </span>
      }
    />
  );
}
