import { describe, expect, it, vi } from "vitest";

import { routeTemplate, scrubMetric, toVitalMetric } from "./web-vitals";

vi.mock("web-vitals", () => ({
  onLCP: vi.fn(),
  onTTFB: vi.fn(),
  onINP: vi.fn(),
  onCLS: vi.fn(),
}));

describe("routeTemplate", () => {
  it("names a screen, never a record", () => {
    expect(routeTemplate("/tasks/3f1c2a9e-1b2c-4d3e-8f90-123456789abc")).toBe("/tasks/:id");
    expect(
      routeTemplate(
        "/clients/3f1c2a9e-1b2c-4d3e-8f90-123456789abc/projects/0f1c2a9e-1b2c-4d3e-8f90-123456789abc",
      ),
    ).toBe("/clients/:id/projects/:id");
    expect(routeTemplate("/reports/end-of-day/2026-11-24")).toBe("/reports/end-of-day/:date");
    expect(routeTemplate("/today?view=week#top")).toBe("/today");
    expect(routeTemplate("/")).toBe("/");
  });

  it("hides anything that is not a plain word", () => {
    expect(routeTemplate("/auth/confirm/AbC_123")).toBe("/auth/confirm/:x");
    expect(routeTemplate("/x/42")).toBe("/x/:n");
  });
});

describe("toVitalMetric", () => {
  it("sends LCP in milliseconds with the route template and the role", () => {
    expect(
      toVitalMetric(
        { name: "LCP", value: 1234.5, rating: "good", navigationType: "navigate" },
        "/tasks/3f1c2a9e-1b2c-4d3e-8f90-123456789abc",
        "staff",
      ),
    ).toEqual({
      name: "web_vital.lcp",
      value: 1234.5,
      unit: "millisecond",
      attributes: { route: "/tasks/:id", role: "staff", rating: "good", navigation: "navigate" },
    });
  });

  it("sends CLS without a unit, and a signed-out page as such", () => {
    expect(toVitalMetric({ name: "CLS", value: 0.02 }, "/login", null)).toMatchObject({
      name: "web_vital.cls",
      unit: "none",
      attributes: { role: "signed-out", rating: "unknown", navigation: "unknown" },
    });
  });

  it("drops a measure it was not asked for, and a value that is not one", () => {
    expect(toVitalMetric({ name: "FCP", value: 10 }, "/today", "owner")).toBeNull();
    expect(toVitalMetric({ name: "INP", value: Number.NaN }, "/today", "owner")).toBeNull();
    expect(toVitalMetric({ name: "INP", value: -1 }, "/today", "owner")).toBeNull();
  });
});

describe("scrubMetric", () => {
  it("keeps the route, role, rating, navigation and the SDK's own attributes only", () => {
    const scrubbed = scrubMetric({
      name: "web_vital.lcp",
      attributes: {
        route: "/today",
        role: "owner",
        rating: "good",
        navigation: "navigate",
        "user.id": "a member",
        "user.email": "someone@example.com",
        "sentry.release": "abc",
      },
    });
    expect(scrubbed.attributes).toEqual({
      route: "/today",
      role: "owner",
      rating: "good",
      navigation: "navigate",
      "sentry.release": "abc",
    });
  });
});

describe("startWebVitals", () => {
  it("reports LCP for the landing screen and INP for the screen on view, with the role then", async () => {
    const vitals = await import("web-vitals");
    const { startWebVitals } = await import("./vitals-sdk");
    const distribution = vi.fn();
    let role: string | null = "admin";
    vi.stubGlobal("window", { location: { pathname: "/today" } });
    startWebVitals(
      { metrics: { distribution } },
      () => role,
      () => 0,
    );
    const lcp = vi.mocked(vitals.onLCP).mock.calls[0]![0];
    const inp = vi.mocked(vitals.onINP).mock.calls[0]![0];
    (window as { location: { pathname: string } }).location.pathname =
      "/tasks/3f1c2a9e-1b2c-4d3e-8f90-123456789abc";
    role = "owner";
    lcp({ name: "LCP", value: 900 } as never);
    inp({ name: "INP", value: 120 } as never);
    expect(distribution).toHaveBeenCalledWith("web_vital.lcp", 900, {
      unit: "millisecond",
      attributes: { route: "/today", role: "owner", rating: "unknown", navigation: "unknown" },
    });
    expect(distribution).toHaveBeenCalledWith("web_vital.inp", 120, {
      unit: "millisecond",
      attributes: { route: "/tasks/:id", role: "owner", rating: "unknown", navigation: "unknown" },
    });
    vi.unstubAllGlobals();
  });

  it("starts nothing for a page load outside the sample", async () => {
    const vitals = await import("web-vitals");
    const { startWebVitals } = await import("./vitals-sdk");
    vi.mocked(vitals.onLCP).mockClear();
    startWebVitals(
      { metrics: { distribution: vi.fn() } },
      () => null,
      () => 1,
    );
    expect(vitals.onLCP).not.toHaveBeenCalled();
  });
});
