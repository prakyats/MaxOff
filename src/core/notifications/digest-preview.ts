import "server-only";

import { createServerSupabase } from "@/core/db/server";

import { type DigestPayload, parseDigestPayload } from "./digest-content";

/**
 * The digest's payload for now, as the signed-in Owner (`owner_digest_preview()`, 5B slice 7): a
 * read only, nothing is written or sent. Null when the database refuses the caller (anyone but
 * the organisation's Owner: FORBIDDEN; signed out: no grant), so the sample route answers 404.
 */
export async function readDigestPreview(): Promise<DigestPayload | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("owner_digest_preview");
  if (error) {
    if (error.message === "FORBIDDEN" || error.code === "42501") return null;
    throw error;
  }
  const payload = parseDigestPayload(data);
  if (!payload) throw new Error("owner_digest_preview: the payload is not a digest");
  return payload;
}
