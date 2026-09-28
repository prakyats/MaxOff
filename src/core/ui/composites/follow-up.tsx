"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

/**
 * A step that follows a confirmed action and belongs to another module (ARCHITECTURE §3.1: a
 * module never imports another). The page composes them: `FollowUpHost` wraps the part of the
 * screen that holds the action and renders the follow-up node it was handed; the action (End
 * day, in `modules/attendance`) calls `useFollowUpTrigger()` once it succeeds; the node (the
 * expense claim form, in `modules/expenses`) reads `useFollowUp()` for whether it is open and
 * for which date. The host holds the state, so the follow-up survives the action's own control
 * disappearing when the screen refreshes (End day's button is gone once the day has ended).
 * Nothing opens by itself: only the person's own choice ("Yes") triggers it.
 */
export type FollowUp = {
  open: boolean;
  /** The IST date the action was about (End day: the day that ended). */
  date: string;
  onOpenChange: (open: boolean) => void;
};

const FollowUpContext = createContext<FollowUp | null>(null);
const TriggerContext = createContext<((date: string) => void) | null>(null);

export function FollowUpHost({ node, children }: { node: ReactNode; children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; date: string }>({ open: false, date: "" });
  const trigger = useCallback((date: string) => setState({ open: true, date }), []);
  const value = useMemo<FollowUp>(
    () => ({
      open: state.open,
      date: state.date,
      onOpenChange: (open) => setState((current) => ({ ...current, open })),
    }),
    [state],
  );
  return (
    <TriggerContext.Provider value={trigger}>
      {children}
      <FollowUpContext.Provider value={value}>{node}</FollowUpContext.Provider>
    </TriggerContext.Provider>
  );
}

/** Opens the host's follow-up for a date; null outside a host (the action then offers none). */
export function useFollowUpTrigger(): ((date: string) => void) | null {
  return useContext(TriggerContext);
}

/** The follow-up this node belongs to; null outside a host (it then never opens). */
export function useFollowUp(): FollowUp | null {
  return useContext(FollowUpContext);
}
