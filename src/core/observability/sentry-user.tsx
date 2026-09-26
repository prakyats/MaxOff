"use client";

import { useEffect } from "react";

import { setClientSentryUser } from "./client";

/**
 * Tags browser-side error reports with the member id (and nothing else), for as long as a
 * signed-in shell is mounted. The app layout renders it; the sign-in pages don't, so a report
 * from /login carries no user.
 */
export function SentryUser({ id }: { id: string }) {
  useEffect(() => {
    setClientSentryUser(id);
    return () => setClientSentryUser(null);
  }, [id]);
  return null;
}
