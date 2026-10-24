"use client";

import { useState } from "react";

import type { InboxCursor, InboxRow } from "@/core/notifications/inbox";
import { useAction } from "@/core/ui/action/use-action";
import { ActionStatus } from "@/core/ui/action/action-status";
import { Button } from "@/core/ui/primitives/button";
import { describeError } from "@/core/ui/toast";

import { loadOlderAlerts } from "../actions/inbox";
import { NotificationList } from "./notification-list";

/**
 * Alerts as one continuous list (V5b-D, the approved pull-in sample): the first entries come with
 * the page, and "Show older" at the foot adds the next ones under them (keyset,
 * `notifications_inbox_page`), so the day groups (Today, Yesterday, Earlier this week, Older) run
 * on across loads and nothing above the button moves. A view control: it never adds history
 * (ARCHITECTURE §14.2 d). The page draws it with a fresh `key` on every server render, so a new
 * read starts it from the newest again.
 */
export function AlertsFeed({
  rows: first,
  next: firstNext,
  unreadOnly,
  today,
  countedAt,
}: {
  rows: InboxRow[];
  next: InboxCursor | null;
  unreadOnly: boolean;
  today: string;
  countedAt: number;
}) {
  const [older, setOlder] = useState<InboxRow[]>([]);
  const [next, setNext] = useState<InboxCursor | null>(firstNext);
  const [problem, setProblem] = useState<string | null>(null);

  const more = useAction(
    async (before: InboxCursor) => {
      setProblem(null);
      const result = await loadOlderAlerts({ before, unreadOnly });
      if (!result.ok) {
        const summary = describeError(result.error);
        setProblem(summary.description ?? summary.title);
        return;
      }
      // A row already shown (a run that grew while the list was open) is never drawn twice.
      setOlder((current) => {
        const seen = new Set([...first, ...current].map((row) => row.id));
        return [...current, ...result.data.rows.filter((row) => !seen.has(row.id))];
      });
      setNext(result.data.next);
    },
    { resetKey: next ? `${next.at}|${next.id}` : null },
  );

  return (
    <>
      <NotificationList rows={[...first, ...older]} today={today} countedAt={countedAt} />
      {next ? (
        <div data-slot="alerts-more" className="mt-4 flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            data-slot="alerts-show-older"
            disabled={more.pending}
            onClick={() => more.run(next)}
          >
            {more.pending ? "Loading…" : "Show older"}
          </Button>
          <ActionStatus action={more} />
          {problem ? (
            <p role="status" className="text-destructive text-sm">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
