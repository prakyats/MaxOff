/**
 * The signed-in member's role, for the real-user measures' `role` attribute (`web-vitals.ts`).
 * Set by `<SentryUser>` in the signed-in shell, cleared when it unmounts; never the member id.
 */
let role: string | null = null;

export function setViewerRole(next: string | null): void {
  role = next;
}

export function viewerRole(): string | null {
  return role;
}
