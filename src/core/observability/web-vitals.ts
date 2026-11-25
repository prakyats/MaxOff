/**
 * Real-user speed (v7.0 unit 1, "Reliable anywhere"; ROADMAP v2.1 unit 1): the team's own phones
 * and laptops report LCP, INP, CLS and TTFB to Sentry as metrics, per screen and role, so the
 * weekly look reads the p75 each screen really gets (ARCHITECTURE §18.4, the runbook
 * `docs/runbooks/real-user-speed.md`).
 *
 * **Nothing personal is sent.** A screen is named by its route template (`/tasks/:id`, never the
 * id), the role is the role's value (`owner`, `admin`, `staff`), and `scrubMetric` keeps only the
 * attributes named here and the SDK's own `sentry.*` ones, so the member id the error reports carry
 * never rides along.
 *
 * Pure functions, unit-tested; the browser half is `vitals-sdk.ts`, loaded with the SDK.
 */

/** The four measures the owner asked for (#89 6802825415). */
export const VITALS = ["LCP", "INP", "CLS", "TTFB"] as const;
export type VitalName = (typeof VITALS)[number];

/**
 * The share of page loads that report. The whole team is about 20 people, so every load counts
 * towards a route's p75; lower it here if the team grows.
 */
export const VITALS_SAMPLE_RATE = 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d+$/;

/**
 * The route template of a path: ids, dates and numbers become `:id`, `:date` and `:n`, so one
 * screen is one series and no record is named. Anything else that is not a known word (a token,
 * a long slug) becomes `:x`.
 */
export function routeTemplate(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "/";
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((part) => {
      if (UUID.test(part)) return ":id";
      if (ISO_DATE.test(part)) return ":date";
      if (NUMBER.test(part)) return ":n";
      if (!/^[a-z][a-z-]{0,30}$/.test(part)) return ":x";
      return part;
    });
  return `/${parts.join("/")}`;
}

/** What web-vitals hands its callbacks (the part used here). */
export interface VitalReport {
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
}

export interface VitalMetric {
  name: string;
  value: number;
  unit: string;
  attributes: { route: string; role: string; rating: string; navigation: string };
}

/** A web-vitals report as the Sentry distribution it is sent as. CLS has no unit. */
export function toVitalMetric(
  report: VitalReport,
  route: string,
  role: string | null,
): VitalMetric | null {
  if (!(VITALS as readonly string[]).includes(report.name)) return null;
  if (!Number.isFinite(report.value) || report.value < 0) return null;
  return {
    name: `web_vital.${report.name.toLowerCase()}`,
    value: report.value,
    unit: report.name === "CLS" ? "none" : "millisecond",
    attributes: {
      route: routeTemplate(route),
      role: role ?? "signed-out",
      rating: report.rating ?? "unknown",
      navigation: report.navigationType ?? "unknown",
    },
  };
}

const KEPT_ATTRIBUTES = new Set(["route", "role", "rating", "navigation"]);

/**
 * `beforeSendMetric`: only the attributes above and the SDK's own `sentry.*` ones leave the
 * browser. The SDK adds `user.id` from the scope the error reports use; it is dropped here.
 */
export function scrubMetric<M extends { attributes?: Record<string, unknown> | undefined }>(
  metric: M,
): M {
  const attributes = Object.fromEntries(
    Object.entries(metric.attributes ?? {}).filter(
      ([key]) => KEPT_ATTRIBUTES.has(key) || key.startsWith("sentry."),
    ),
  );
  return { ...metric, attributes };
}
