"use client";

import { useCallback, useState } from "react";

/**
 * One request key per opened form (v7.0 unit 2, owner Q3: repeat-safe creates): sent with the
 * create, and the same on every Retry, so a create whose reply was lost is answered with what it
 * already made instead of being made twice (`request_keys`, the `_once` functions; a plain insert's
 * unique `request_key`). A new key when the form's target changes (`resetKey`, as `useAction`'s)
 * and after a create has landed (`renew`), so the next create is a new one.
 */
export function useRequestKey(resetKey?: string | number | boolean | null): {
  key: string;
  renew: () => void;
} {
  const [key, setKey] = useState(newKey);
  const [seen, setSeen] = useState(resetKey);
  if (!Object.is(seen, resetKey)) {
    setSeen(resetKey);
    setKey(newKey());
  }
  const renew = useCallback(() => setKey(newKey()), []);
  return { key, renew };
}

function newKey(): string {
  return crypto.randomUUID();
}
