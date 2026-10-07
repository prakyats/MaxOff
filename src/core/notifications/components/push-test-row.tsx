"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { sendTestPush } from "../actions";
import { testOutcome } from "../push/test-outcome";

/** "Did it arrive?" (5.5), loaded only once a test was accepted. */
const DidItArrive = dynamic(() => import("./did-it-arrive").then((module) => module.DidItArrive), {
  ssr: false,
});

/**
 * **Send a test notification** (task 5.2; under Me's "Help & troubleshooting" since 5B decision
 * 4): pushes to every active device of the member right now, quiet hours ignored, and reports
 * what the push services accepted. One row whose words follow the outcome; once a push service
 * accepted it, **"Did it arrive? Yes / No"** follows (5.5, owner decision 2026-10-03, 6).
 */
export function PushTestRow({
  endpoints,
}: {
  /** The member's active endpoints (their own devices), from the server. */
  endpoints: readonly string[];
}) {
  // `round` counts the tests, so each accepted one asks afresh.
  const [outcome, setOutcome] = useState<{
    text: string;
    delivered: boolean;
    round: number;
  } | null>(null);
  const test = useAction(async () => {
    const result = await sendTestPush();
    if (!result.ok) {
      toastResult(result);
      return;
    }
    const next = testOutcome(result.data);
    setOutcome((previous) => ({ ...next, round: (previous?.round ?? 0) + 1 }));
  });
  return (
    <div data-slot="push-test-row" className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-[1_1_10rem]">
        <p className="text-sm font-medium">Send a test notification</p>
        <p
          className="text-muted-foreground text-sm"
          data-slot="push-test-outcome"
          aria-live="polite"
        >
          {outcome?.text ?? "A push to every device you turned on, right now, quiet hours or not."}
        </p>
        <ActionStatus action={test} className="mt-1" />
      </div>
      <Button
        variant="secondary"
        onClick={() => test.run()}
        disabled={test.pending || endpoints.length === 0}
        data-slot="push-test"
      >
        {test.pending ? "Sending…" : "Send test"}
      </Button>
      {/* A fresh question for each accepted test. */}
      {outcome?.delivered ? (
        <div className="basis-full">
          <DidItArrive key={outcome.round} />
        </div>
      ) : null}
    </div>
  );
}
