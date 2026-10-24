"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { HistoryButton } from "@/core/ui/composites/history-button";

/** The sheet's code arrives on the first tap (ARCHITECTURE §19: the person's pages never grow). */
const PersonHistoryPanel = dynamic(
  () => import("./person-history-panel").then((module) => module.PersonHistoryPanel),
  { ssr: false },
);

/**
 * A person's **History** (PP-person-1; FINAL 6: the clock in every detail header, before ⋯): the
 * trigger, and the sheet that reads the history only when it opens. Each opening mounts the panel
 * afresh, so it reads the newest lines.
 */
export function PersonHistoryButton({ memberId }: { memberId: string }) {
  const [opened, setOpened] = useState(0);
  const [open, setOpen] = useState(false);
  return (
    <>
      <HistoryButton
        onOpen={() => {
          setOpened((count) => count + 1);
          setOpen(true);
        }}
      />
      {opened > 0 ? (
        <PersonHistoryPanel key={opened} memberId={memberId} open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
