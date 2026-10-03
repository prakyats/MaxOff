import "server-only";

import { createServerSupabase } from "@/core/db/server";

/**
 * A new joiner's first-login walkthrough (task 5.5, owner decisions 2026-10-03; DATA-MODEL §9
 * `member_onboarding`): install on iPhone, turn on notifications, send a test. The row is written
 * by `member_accept_invite()` (the first login) for members who joined after 5.5 shipped, so
 * nobody already on the team ever has one. Read as the member (RLS: own row); finished only
 * through `onboarding_finish()`.
 */
export type FinishedVia = "test" | "later";

export interface OwnOnboarding {
  finished: boolean;
  finishedVia: FinishedVia | null;
}

/** The caller's walkthrough, or null when they have none (everyone who joined before 5.5). */
export async function readOwnOnboarding(): Promise<OwnOnboarding | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("member_onboarding")
    .select("finished_at, finished_via")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    finished: data.finished_at !== null,
    finishedVia:
      data.finished_via === "test" || data.finished_via === "later" ? data.finished_via : null,
  };
}

/** Finishes the caller's walkthrough once ('test' only after a delivered push). */
export async function rpcOnboardingFinish(via: FinishedVia): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("onboarding_finish", { p_via: via });
  if (error) throw error;
  return data;
}
