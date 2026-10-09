"use client";

import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";

import type { ItemView } from "../domain/views";

import { ItemSheet, type ItemPermissions } from "./item-sheet";
import { MARK_DONE_URL, useUndoSends } from "./use-undo-sends";

export type TodayItem = {
  view: ItemView;
  /** "Monthly reels · Sharma Weddings". */
  where: string;
  href: string;
};

/**
 * The Admin's **Client work** on Today (7.3; PRODUCT §4.7, kickoff 7 decision 19): the items
 * overdue or due this week, oldest first (the server sends at most five). Each row has one neutral
 * **Mark done**, instant with the 6-second Undo (a delayed send, flushed when the app is hidden or
 * left, as Approvals' Approve; done is the approval since amendment D3), and a tap on the row
 * opens the item sheet (its own stages, notes, last change) with a way to the project; the sheet's
 * Mark done takes the same Undo. A row stays, faded, until the server's refreshed list arrives. Loaded after
 * the page (`today/client-work-lazy.tsx`): Today's first load never grows (ARCHITECTURE §19).
 */
export function TodayClientWork({
  items,
  permissions,
}: {
  items: readonly TodayItem[];
  permissions: ItemPermissions;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { held, errors, start } = useUndoSends({
    url: MARK_DONE_URL,
    body: (id) => ({ id }),
    said: (title) => `Marked ${title} done`,
    notDone: "It was not marked done.",
    tooLate: "Undo came too late: it was marked done.",
    toastKey: "item-done",
  });

  const open = items.find((item) => item.view.id === openId) ?? null;
  return (
    <>
      <ul
        aria-label="Client work"
        data-slot="today-client-work-rows"
        className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
      >
        {items.map((item) => {
          const waiting = held.has(item.view.id);
          return (
            <li
              key={item.view.id}
              data-slot="today-client-item"
              data-held={waiting ? "" : undefined}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 transition-opacity",
                waiting && "opacity-50",
              )}
            >
              <button
                type="button"
                onClick={() => setOpenId(item.view.id)}
                className="pressable-row flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center gap-0.5 text-left"
              >
                <span className="text-sm font-medium break-words">{item.view.title}</span>
                <span className="text-muted-foreground text-xs break-words">
                  {item.where}
                  {item.view.planned ? (
                    <>
                      {" · "}
                      <span className={cn(item.view.planned.overdue && "text-destructive")}>
                        {item.view.planned.text}
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
              {permissions.tick ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto shrink-0"
                  disabled={waiting}
                  data-slot="today-item-done"
                  onClick={() => start(item.view.id, item.view.title)}
                >
                  Mark done
                </Button>
              ) : null}
              {errors[item.view.id] ? (
                <ErrorText className="basis-full">{errors[item.view.id]}</ErrorText>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ItemSheet
        item={open?.view ?? null}
        permissions={permissions}
        open={open !== null}
        onOpenChange={(next) => (next ? null : setOpenId(null))}
        onMarkDone={(item) => start(item.id, item.title)}
        {...(open ? { projectHref: open.href } : {})}
      />
    </>
  );
}
