import { onCLS, onINP, onLCP, onTTFB } from "web-vitals";

import { toVitalMetric, VITALS_SAMPLE_RATE, type VitalReport } from "./web-vitals";

/** The part of the Sentry SDK the vitals use. */
export interface VitalsSdk {
  metrics: {
    distribution(
      name: string,
      value: number,
      options: { unit: string; attributes: Record<string, string> },
    ): void;
  };
}

/**
 * Starts the real-user measures (v7.0 unit 1; `web-vitals.ts`). Loaded with the Sentry SDK, once
 * the page is idle, so the first load carries none of it: the observers read the browser's
 * buffered entries, so a page's LCP, its layout shifts and its interactions from before are still
 * seen. LCP and TTFB belong to the screen the page loaded on; INP and CLS are reported when the
 * page is hidden, named after the screen on view then. `role` is read at each report, so a
 * sign-in or sign-out in between is followed.
 */
export function startWebVitals(
  sdk: VitalsSdk,
  role: () => string | null,
  random: () => number = Math.random,
): void {
  if (random() >= VITALS_SAMPLE_RATE) return;
  const landing = window.location.pathname;
  const send = (route: () => string) => (report: VitalReport) => {
    const metric = toVitalMetric(report, route(), role());
    if (metric) {
      sdk.metrics.distribution(metric.name, metric.value, {
        unit: metric.unit,
        attributes: metric.attributes,
      });
    }
  };
  const onLanding = send(() => landing);
  const onCurrent = send(() => window.location.pathname);
  onLCP(onLanding);
  onTTFB(onLanding);
  onINP(onCurrent);
  onCLS(onCurrent);
}
