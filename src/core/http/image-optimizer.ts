/**
 * MaxOff serves no `next/image` (the guide's pictures are pre-sized WebP files in `public/`), so
 * the image optimizer's route, `/_next/image`, has nothing to do here and is closed (v2.0.1,
 * `pnpm audit --prod`: next ≤ 16.4.0 had an unauthenticated remote code execution and an SSRF in
 * that route). Two locks, because two different programs can answer it:
 *   - `next start` (local, e2e): `images.unoptimized` in `next.config.ts`, so Next answers 404;
 *   - the Worker: OpenNext answers `/_next/image` itself before the Next server runs and does not
 *     read `images.unoptimized`, so `worker/index.js` refuses it first, with this check.
 * Pure, so `worker/index.js` and the unit test share it.
 */
export const IMAGE_OPTIMIZER_PATH = "/_next/image";

export function isImageOptimizerRequest(requestUrl: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return false;
  }
  // Paths are case-sensitive for the router, but refuse any spelling a server might normalise.
  const path = pathname.toLowerCase().replace(/\/+$/, "");
  return path === IMAGE_OPTIMIZER_PATH;
}
