"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { ACTION_SLOW_MS, isNetworkError } from "./network-error";

export type ActionState = {
  /** The action is on its way: the button shows its spinner and working label, disabled. */
  pending: boolean;
  /** Pending for longer than `ACTION_SLOW_MS`: "Still working… slow connection". */
  slow: boolean;
  /** The request never got an answer: "Couldn't reach MaxOff", with Retry. */
  failed: boolean;
  /** The same action again, with the same arguments; its answer re-reads the screen. */
  retry: () => void;
  /**
   * It creates something: after a lost reply it may already exist, so the status line says so
   * and offers no Retry (a second create would make a duplicate; PROGRESS Ideas: request keys).
   */
  creates: boolean;
};

export type ActionOptions = {
  /**
   * What the action is for right now: a dialog's open state, the item a sheet shows. When it
   * changes, a failure or slowness from before is forgotten, so Retry can never re-send an earlier
   * item's request while another is on screen (found in the v1.0.0 review: reject claim A fails,
   * the dialog opens for B, Retry would have rejected B with A's reason).
   */
  resetKey?: unknown;
  /** See `ActionState.creates`. */
  creates?: boolean;
};

/**
 * Runs a server action the way every commit button in MaxOff does (ARCHITECTURE §14.1, owner
 * 2026-09-28), so the button, its status line and the rules live in one place:
 *
 * - **one request per tap**: a second call while one is running does nothing, even before React
 *   has re-rendered the button as disabled (a quick double tap sends one request);
 * - **pending at once**: set with the tap, so the button shows its spinner and working label in
 *   the same frame, and cleared as soon as the action has answered;
 * - **slow**: after 8 s the status line says the connection is slow (never a blocking overlay);
 * - **failed**: a network failure is caught instead of reaching the error boundary, so the form,
 *   and everything typed into it, stays as it was; Retry sends the same action again, and its
 *   answer re-reads the screen. A **state change** that did land is refused the second time and
 *   says so; a **create** (`creates`) is not, so it offers no Retry, only "it may have been
 *   saved: check before trying again". The request is never aborted on a timer: a server action
 *   cannot be recalled, so the person decides. `resetKey` forgets a failure when the target
 *   changes.
 *
 * `fn` does what the handler did before: calls the action and handles its `Result` (a refusal
 * is a `Result`, not a throw). Anything else it throws still goes to the error boundary.
 */
export function useAction<Args extends unknown[]>(
  fn: (...args: Args) => Promise<unknown>,
  { resetKey, creates = false }: ActionOptions = {},
): ActionState & { run: (...args: Args) => void } {
  // Pending means "the request is on its way": set with the tap, cleared the moment the action
  // settles. Not the transition's own pending, which lasts until the router has re-rendered
  // after the action's revalidation: a dialog that had already closed then refused to open
  // again, a dead tap (found by the e2e suite, 2026-09-28).
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  // Each run has an id; the slow timer it starts marks only that run, so a finished or newer run
  // is never called slow.
  const [runId, setRunId] = useState(0);
  const [slowRunId, setSlowRunId] = useState(-1);
  const [failed, setFailed] = useState(false);
  // A new target forgets the old failure (adjusted during render, React's pattern for state that
  // follows a prop, so no frame ever shows the old Retry).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (!Object.is(seenKey, resetKey)) {
    setSeenKey(resetKey);
    setFailed(false);
    setSlowRunId(-1);
  }
  const running = useRef(false);
  const nextRunId = useRef(0);
  const last = useRef<Args | null>(null);
  // The latest handler, so `run` stays stable while `fn` closes over fresh state.
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  const run = useCallback((...args: Args) => {
    if (running.current) return;
    running.current = true;
    last.current = args;
    const id = ++nextRunId.current;
    setRunId(id);
    setPending(true);
    setFailed(false);
    window.setTimeout(() => setSlowRunId(id), ACTION_SLOW_MS);
    startTransition(async () => {
      try {
        await latest.current(...args);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        setFailed(true);
      } finally {
        running.current = false;
        setPending(false);
      }
    });
  }, []);

  // The same action again. Not a refresh first: a refresh racing the resend could land after the
  // resend's own revalidation and put the old data back on screen (found by the e2e suite).
  const retry = useCallback(() => {
    const args = last.current;
    if (args) run(...args);
  }, [run]);

  return { run, pending, slow: pending && slowRunId === runId, failed, retry, creates };
}
