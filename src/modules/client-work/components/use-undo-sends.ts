"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { NETWORK_ERROR_MESSAGE } from "@/core/ui/action/network-error";
import { DelayedSends, UNDO_MS } from "@/core/ui/delayed-sends";
import { postKeepalive } from "@/core/ui/keepalive";
import { describeError } from "@/core/ui/toast";

/** The routes behind the delayed sends: they outlive the page (a keepalive request). */
export const MARK_DONE_URL = "/api/client-work/mark-done";
export const APPROVE_URL = "/api/approvals/approve";

export type UndoSendConfig = {
  url: string;
  /** The request body for one item. */
  body: (itemId: string) => unknown;
  /** The toast while Undo is offered: "Marked Reel 1 done", "Approved Reel 1". */
  said: (title: string) => string;
  /** What did not happen when the send failed on the network: "It was not approved." */
  notDone: string;
  /** Undo after the send left: "Undo came too late: it was approved." */
  tooLate: string;
  /** Keeps each item's toast apart: "item-done", "item-approve". */
  toastKey: string;
};

export type UndoSends = {
  /** Items inside their Undo window or sent and waiting for the refreshed list: drawn faded. */
  held: ReadonlySet<string>;
  /** A failed send's message per item, under its row. */
  errors: Readonly<Record<string, string>>;
  start: (itemId: string, title: string) => void;
};

/**
 * **Instant, with the 6-second Undo** (WORKFLOWS §1 "Settled in 2.4"; the client-work rows'
 * Mark done and Approve, as Approvals' Approve): nothing is sent until the Undo toast has gone
 * (`DelayedSends`), Undo drops it, and every send still waiting leaves at once when the app is
 * hidden, left or the list unmounts, so nothing is ever lost. A held row stays, faded, until the
 * server's refreshed list arrives; a failed send puts the row back with its message.
 */
export function useUndoSends(config: UndoSendConfig): UndoSends {
  const router = useRouter();
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const latest = useRef({ router, config });
  useEffect(() => {
    latest.current = { router, config };
  });

  const sends = useRef<DelayedSends | null>(null);
  useEffect(() => {
    const release = (itemId: string) =>
      setHeld((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    const current = new DelayedSends((itemId) => {
      const { config: now } = latest.current;
      toast.dismiss(`${now.toastKey}-${itemId}`);
      const failed = (message: string) => {
        setErrors((shown) => ({ ...shown, [itemId]: message }));
        release(itemId);
      };
      postKeepalive<null>(now.url, now.body(itemId)).then(
        (result) => {
          if (!result.ok) {
            const { title, description } = describeError(result.error);
            failed(description ?? title);
            return;
          }
          latest.current.router.refresh();
        },
        () => failed(`${NETWORK_ERROR_MESSAGE} ${now.notDone}`),
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

  function start(itemId: string, title: string) {
    const { config: now } = latest.current;
    setErrors((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    setHeld((current) => new Set(current).add(itemId));
    sends.current?.schedule(itemId);
    toast(now.said(title), {
      id: `${now.toastKey}-${itemId}`,
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (sends.current?.undo(itemId)) {
            setHeld((current) => {
              const next = new Set(current);
              next.delete(itemId);
              return next;
            });
          } else {
            toast("Already sent", { description: latest.current.config.tooLate });
          }
        },
      },
    });
  }

  return { held, errors, start };
}
