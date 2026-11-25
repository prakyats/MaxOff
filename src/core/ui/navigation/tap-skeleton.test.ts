import { describe, expect, it } from "vitest";

import { NAV_PENDING_ATTRIBUTE } from "./progress";
import { claimedBy, NAV_PENDING, registerTapSpec, type TapSpec } from "./tap-skeleton";

const ORIGIN = "https://app.example";

const spec = (key: string, prefix: string): TapSpec => ({
  key,
  match: (href, origin) => {
    const url = new URL(href, origin);
    return url.origin === origin && url.pathname.startsWith(prefix)
      ? { pathname: url.pathname, href: url.pathname, variant: "only" }
      : null;
  },
  screen: `[data-slot="loading-${key}"]`,
  backLabel: () => "Back",
  drawing: () => undefined,
});

describe("the tap-skeleton engine (#143, v7.0)", () => {
  it("names the attribute the progress bar sets", () => {
    expect(NAV_PENDING).toBe(NAV_PENDING_ATTRIBUTE);
  });

  it("finds the registered screen that claims a link, and none for an unclaimed one", () => {
    registerTapSpec(spec("alpha", "/alpha/"));
    registerTapSpec(spec("beta", "/beta/"));
    expect(claimedBy("/alpha/1", ORIGIN)).toBe("alpha");
    expect(claimedBy(`${ORIGIN}/beta/2`, ORIGIN)).toBe("beta");
    expect(claimedBy("/gamma/3", ORIGIN)).toBeNull();
    expect(claimedBy("https://elsewhere.example/alpha/1", ORIGIN)).toBeNull();
  });

  it("keeps one spec per key: registering again replaces it", () => {
    registerTapSpec(spec("alpha", "/alpha-new/"));
    expect(claimedBy("/alpha/1", ORIGIN)).toBeNull();
    expect(claimedBy("/alpha-new/1", ORIGIN)).toBe("alpha");
  });
});
