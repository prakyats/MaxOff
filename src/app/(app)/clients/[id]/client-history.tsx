"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { HistoryButton } from "@/core/ui/composites/history-button";
import { useHistoryArrival } from "@/core/ui/composites/history-sheet";

/** The sheet's code arrives on the first tap (ARCHITECTURE §19: the client's pages never grow). */
const ClientHistoryPanel = dynamic(
  () => import("./client-history-panel").then((module) => module.ClientHistoryPanel),
  { ssr: false },
);

/** The old Activity tab's path redirects with this: the sheet opens on arrival. */
const HISTORY_ARRIVAL = { history: "1" };

/**
 * A client's **History** (3.4, PRODUCT §4.4; the header's clock since the v1.8 consistency sweep):
 * the trigger, and the sheet that **reads the history only when it opens** (`ClientHistoryPanel`),
 * never with the client's layout, so a client row's prefetch and every tab switch read the
 * layout's few reads alone (P2 item 6). Each opening mounts the panel afresh (its key), so it reads
 * the newest lines; closing keeps it mounted for its animation. An old Activity link
 * (`?history=1`) opens it on arrival.
 */
export function ClientHistoryButton({ clientId }: { clientId: string }) {
  const [opened, setOpened] = useState(0);
  const [open, setOpen] = useState(false);
  function show() {
    setOpened((count) => count + 1);
    setOpen(true);
  }
  useHistoryArrival(HISTORY_ARRIVAL, show);
  return (
    <>
      <HistoryButton onOpen={show} />
      {opened > 0 ? (
        <ClientHistoryPanel key={opened} clientId={clientId} open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
