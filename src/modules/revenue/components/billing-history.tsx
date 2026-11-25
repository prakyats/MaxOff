"use client";

import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getInBackground } from "@/core/http/background";
import { Button } from "@/core/ui/primitives/button";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import type { BillingHistoryPage } from "../actions/background";
import { HISTORY_PAGE, mayHaveOlder, nextHistoryLimit } from "../domain/history-page";

import {
  BILLING_CHEVRON,
  BILLING_DISCLOSURE,
  BILLING_ROW_TEXT,
  BILLING_SUMMARY,
} from "./billing-layout";

type Loaded = BillingHistoryPage & { limit: number };

/**
 * The Billing section's **Billing history** (v2.5, kickoff 9 Q7): collapsed by default, one row
 * like the section's others. Opening it (a view control: no history entry, nothing kept) asks for
 * the newest 20 changes; "Show older" asks again for 20 more, up to the function's 200. The read
 * waits for the tap, so the project page itself never carries it. After any change in the section
 * (`revision` moves), an open history reads again. Owner only, like the section.
 */
export function BillingHistory({
  projectId,
  oneTime,
  revision,
}: {
  projectId: string;
  oneTime: boolean;
  /** Changes whenever what the section shows changes: an open history then reads again. */
  revision: string;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const [attempt, setAttempt] = useState(0);
  // What the last answer was asked for: the screen is pending until the latest request answers.
  const [answer, setAnswer] = useState<{
    key: string;
    loaded: Loaded | null;
    failed: boolean;
  } | null>(null);
  const latest = useRef("");
  const key = `${projectId}|${limit}|${revision}|${attempt}`;

  useEffect(() => {
    if (!open) return;
    latest.current = key;
    getInBackground<BillingHistoryPage>("/api/revenue/billing-history", {
      project: projectId,
      limit: String(limit),
      oneTime: oneTime ? "1" : "0",
    }).then((result) => {
      if (latest.current !== key) return;
      setAnswer((before) => ({
        key,
        loaded: result.ok ? { ...result.data, limit } : (before?.loaded ?? null),
        failed: !result.ok,
      }));
    });
  }, [open, key, projectId, limit, oneTime]);

  const loaded = answer?.loaded ?? null;
  const failed = answer?.key === key && answer.failed;
  const pending = open && answer?.key !== key;
  const older = loaded !== null && mayHaveOlder(loaded.rows, loaded.limit);
  return (
    <details
      className={BILLING_DISCLOSURE}
      data-slot="billing-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={BILLING_SUMMARY} data-slot="billing-history-toggle">
        <span className={BILLING_ROW_TEXT}>
          <span className="font-medium">Billing history</span>
          <span className="text-muted-foreground truncate text-xs">
            Every change to amounts, prices and billing, newest first
          </span>
        </span>
        <ChevronRightIcon aria-hidden className={BILLING_CHEVRON} />
      </summary>
      {/* Drawn only while open: closed, the history holds nothing (no skeleton, no request). */}
      {open ? (
        <div
          className="border-border border-t"
          aria-busy={pending}
          data-slot="billing-history-body"
        >
          {failed && loaded === null ? (
            <div className="flex min-h-16 items-center gap-3 px-4 py-2" role="alert">
              <p className="min-w-0 flex-1">Billing history couldn&apos;t load.</p>
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                data-slot="billing-history-retry"
                onClick={() => setAttempt((count) => count + 1)}
              >
                Try again
              </Button>
            </div>
          ) : loaded === null ? (
            <ul aria-label="Loading billing history" className="divide-border divide-y">
              {[0, 1, 2].map((row) => (
                <li key={row} className="flex flex-col gap-0.5 px-4 py-2">
                  <span className="flex h-4 items-center">
                    <Skeleton className="h-3 w-32" />
                  </span>
                  <span className="flex h-5 items-center">
                    <Skeleton className="h-3.5 w-48" />
                  </span>
                </li>
              ))}
            </ul>
          ) : loaded.entries.length === 0 ? (
            <p className="text-muted-foreground px-4 py-3" data-slot="billing-history-empty">
              No billing changes yet.
            </p>
          ) : (
            <>
              <ol className="divide-border divide-y" data-slot="billing-history-rows">
                {loaded.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-0.5 px-4 py-2"
                    data-slot="billing-history-row"
                  >
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {entry.when} · {entry.who}
                    </span>
                    <span className="break-words tabular-nums" data-slot="billing-history-what">
                      {entry.what}
                    </span>
                  </li>
                ))}
              </ol>
              {failed ? (
                <p className="text-danger px-4 pb-2 text-xs" role="alert">
                  Older changes couldn&apos;t load. Try again.
                </p>
              ) : null}
              {older ? (
                <div className="border-border border-t px-4 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    data-slot="billing-history-older"
                    pending={pending}
                    pendingLabel="Loading…"
                    onClick={() =>
                      failed ? setAttempt((count) => count + 1) : setLimit(nextHistoryLimit)
                    }
                  >
                    Show older
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </details>
  );
}
