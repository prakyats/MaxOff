"use client";

import { type ReactNode, useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

import { HelpTrigger } from "./help-trigger";

const loadPanel = () => import("./help-sheet-panel").then((module) => module.HelpSheetPanel);

/**
 * Where a screen's explanatory paragraph goes on a phone (ARCHITECTURE §14.1): a small "i" in the
 * title bar that opens a bottom sheet (`HelpSheetPanel`). The sheet is **loaded after the page**
 * (6.0, the first-load diet; ARCHITECTURE §19): every screen's title bar can carry one, and the
 * sheet draws nothing until it is opened. Until it arrives the same "i" stands in; a tap on it
 * opens the sheet as soon as the code is there.
 */
export function HelpSheet({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [wanted, setWanted] = useState(false);
  return (
    <AfterPage
      load={loadPanel}
      props={{ title, children, defaultOpen: wanted }}
      fallback={
        <HelpTrigger aria-haspopup="dialog" aria-expanded={false} onClick={() => setWanted(true)} />
      }
    />
  );
}
