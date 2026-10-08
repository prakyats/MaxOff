"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/core/lib/utils";
import { NETWORK_ERROR_MESSAGE } from "@/core/ui/action/network-error";
import { ErrorText } from "@/core/ui/composites/error-text";
import { DelayedSends, UNDO_MS } from "@/core/ui/delayed-sends";
import { postKeepalive } from "@/core/ui/keepalive";
import { Button } from "@/core/ui/primitives/button";
import { describeError } from "@/core/ui/toast";

import type { ItemView } from "../domain/views";

import { ItemSheet, type ItemPermissions } from "./item-sheet";

/** The route behind the delayed send: it outlives the page. */
const MARK_DONE_URL = "/api/client-work/mark-done";

export type TodayItem = {
  view: ItemView;
  /** "Monthly reels · Sharma Weddings". */
  where: string;
  href: string;
  stages: { id: string; name: string }[];
};

const toastId = (id: string) => `item-done-${id}`;

/**
 * The Admin's **Client work** on Today (7.3; PRODUCT §4.7, kickoff 7 decision 19): the items
 * overdue or due this week, oldest first (the server sends at most five). Each row has one neutral
 * **Mark done**, instant with the 6-second Undo (a delayed send, flushed when the app is hidden or
 * left, as Approvals' Approve), and a tap on the row opens the item sheet (stages, notes) with a
 * way to the project. A row stays, faded, until the server's refreshed list arrives. Loaded after
 * the page (`today/client-work-lazy.tsx`): Today's first load never grows (ARCHITECTURE §19).
 */
export function TodayClientWork({
  items,
  permissions,
}: {
  items: readonly TodayItem[];
  permissions: ItemPermissions;
}) {
  const router = useRouter();
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const latest = useRef({ router });
  useEffect(() => {
    latest.current = { router };
  });

  const sends = useRef<DelayedSends | null>(null);
  useEffect(() => {
    const current = new DelayedSends((itemId) => {
      toast.dismiss(toastId(itemId));
      const failed = (message: string) => {
        setErrors((errors) => ({ ...errors, [itemId]: message }));
        setHeld((held) => {
          const next = new Set(held);
          next.delete(itemId);
          return next;
        });
      };
      postKeepalive<null>(MARK_DONE_URL, { id: itemId }).then(
        (result) => {
          if (!result.ok) {
            const { title, description } = describeError(result.error);
            failed(description ?? title);
            return;
          }
          latest.current.router.refresh();
        },
        () => failed(`${NETWORK_ERROR_MESSAGE} It was not marked done.`),
      );
    }, UNDO_MS);
    sends.current = current;
    const onHidden = () => {
      if (document.visibilityState === "hidden") current.flush();
    };
    const onPageHide = () => current.flush();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      current.flush();
      sends.current = null;
    };
  }, []);

  function markDone(item: TodayItem) {
    const id = item.view.id;
    setErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setHeld((current) => new Set(current).add(id));
    sends.current?.schedule(id);
    toast(`Marked ${item.view.title} done`, {
      id: toastId(id),
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (sends.current?.undo(id)) {
            setHeld((current) => {
              const next = new Set(current);
              next.delete(id);
              return next;
            });
          } else {
            toast("Already sent", { description: "Undo came too late: it was marked done." });
          }
        },
      },
    });
  }

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
                  onClick={() => markDone(item)}
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
        stages={open?.stages ?? []}
        permissions={permissions}
        open={open !== null}
        onOpenChange={(next) => (next ? null : setOpenId(null))}
        {...(open ? { projectHref: open.href } : {})}
      />
    </>
  );
}
