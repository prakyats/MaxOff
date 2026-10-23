/**
 * A read the `(app)` layout awaits outside every `<Suspense>` (the push band, the Start-day
 * prompt's day), never failing: a transient refusal or timeout used to turn a full page load into
 * the app's error page (HTTP 500, v1.8). The failure is `report`ed and the read answers `none`
 * (no band, no prompt), exactly as `countsOrNone` does for the nav counts. The reporter rethrows
 * Next's own signals (`unstable_rethrow`), so a redirect still goes through.
 */
export function orNone<Value, None>(
  read: Promise<Value>,
  none: None,
  report: (error: unknown) => void,
): Promise<Value | None> {
  return read.catch((error: unknown) => {
    report(error);
    return none;
  });
}
