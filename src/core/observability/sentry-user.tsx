"use client";

import { useEffect } from "react";

import { setClientSentryUser } from "./client";

/**
 * Tags browser-side error reports with the member id (and nothing else), for as long as a
 * signed-in shell is mounted, and the real-user speed measures with the role (v7.0 unit 1). The
 * app layout renders it; the sign-in pages don't, so a report from /login carries no user.
 */
export function SentryUser({ id, role }: { id: string; role: string }) {
  useEffect(() => {
    setClientSentryUser(id, role);
    return () => setClientSentryUser(null);
  }, [id, role]);
  return null;
}
