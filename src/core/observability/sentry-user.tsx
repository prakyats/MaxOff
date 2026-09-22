"use client";

import { useEffect } from "react";

import { setSentryUser } from "./user";

/**
 * Tags browser-side error reports with the member id (and nothing else), for as long as a
 * signed-in shell is mounted. The app layout renders it; the sign-in pages don't, so a report
 * from /login carries no user.
 */
export function SentryUser({ id }: { id: string }) {
  useEffect(() => {
    setSentryUser(id);
    return () => setSentryUser(null);
  }, [id]);
  return null;
}
