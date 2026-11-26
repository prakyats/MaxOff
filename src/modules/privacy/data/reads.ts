import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

/**
 * The member's own record of reading the privacy notice (DATA-MODEL `privacy_notice_reads`;
 * CLAUDE.md rule 3). RLS shows each member their own row only. Once per request (`cache()`):
 * the home screen and Me may both ask.
 */
export const getOwnNoticeRead = cache(
  async (): Promise<{ version: string; readAt: string } | null> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("privacy_notice_reads")
      .select("version, read_at")
      .maybeSingle();
    if (error) throw error;
    return data ? { version: data.version, readAt: data.read_at } : null;
  },
);

/** The caller confirms reading `version` (`privacy_notice_read()`: their own row, audited). */
export async function rpcNoticeRead(version: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("privacy_notice_read", { p_version: version });
  if (error) throw error;
}
