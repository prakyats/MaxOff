/**
 * The one document load a `page.goBack()` / `page.goForward()` that resolved `null` may still
 * cause (fix-goback-guard, 26 Nov 2026; `back-gesture.spec:94`).
 *
 * Playwright resolves a traversal on the first navigation event it sees. When the page being
 * left writes its own history at that moment (Next's router `replaceState`s once it hydrates,
 * right after `load`), that same-document write is taken as the traversal's answer: the call
 * resolves `null` in a few milliseconds, and the real cross-document load of the target entry
 * starts after it, outside the call. The reload guard then read the test's own back as a
 * surprise.
 *
 * So, strictly: after a `null` traversal whose target entry is another document, the guard lets
 * **one** main-frame document load of **that entry's URL** through, within `TRAVERSAL_CAP_MS`.
 * Any other URL, a second load, or a load after the cap is still a surprise. Pure, so the rule
 * is unit-tested on its own (`tests/document-loads.test.ts`).
 */
export const TRAVERSAL_CAP_MS = 2_000;

export class TraversalAllowance {
  private granted: { url: string; until: number } | null = null;

  /** A traversal resolved `null` while its target, `url`, is another document. */
  grant(url: string, now: number): void {
    this.granted = { url: normalise(url), until: now + TRAVERSAL_CAP_MS };
  }

  /** Whether this document load is the one granted; it uses the grant up. */
  take(url: string, now: number): boolean {
    const granted = this.granted;
    if (!granted) return false;
    if (now > granted.until) {
      this.granted = null;
      return false;
    }
    if (normalise(url) !== granted.url) return false;
    this.granted = null;
    return true;
  }
}

function normalise(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}
