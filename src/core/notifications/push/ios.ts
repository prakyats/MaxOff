/**
 * Whether a browser is an iPhone, iPad or iPod (5.2), on its own so the sign-in form (5.5) can ask
 * without loading the rest of the push setup. iPadOS 13+ presents itself as a Mac; the touch
 * points give it away.
 */
export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
