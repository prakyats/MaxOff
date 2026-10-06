import { postInBackground } from "@/core/http/background";

import { appReportOf } from "./browser";

/**
 * The app's report about itself, sent once per open (task 5.4, owner decision 2026-10-03; the
 * values come from `appReportOf`). Loaded by `PushSync` with `import()`, after the first load, so
 * no screen's first load carries it. One report per app open: a navigation keeps this module, a
 * new document (a new open) starts again. A background call (ARCHITECTURE §4.4): a plain request
 * to `/api/app-report`, never a server action, which would hold a navigation it went out during.
 */
let sent = false;

/** Sends this open's report once, in the background; a failure is silent (the next open reports). */
export function sendAppReportOnce(): void {
  if (sent) return;
  sent = true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const report = appReportOf({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    displayStandalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    navigatorStandalone: nav.standalone,
  });
  void postInBackground<null>("/api/app-report", report);
}
