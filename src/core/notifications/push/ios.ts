/**
 * Whether a browser is an iPhone, iPad or iPod (5.2). iPadOS 13+ presents itself as a Mac; the
 * touch points give it away.
 */
export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
