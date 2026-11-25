import { renderToStaticMarkup } from "react-dom/server";
import { usePathname } from "next/navigation";
import { describe, expect, it } from "vitest";

import { PathnameContext, PrefetchKind } from "./next-internals";

/**
 * The Next-upgrade guard (v7.0): each internal MaxOff relies on is still where it was and still
 * does what the app uses it for. A failure here means a Next upgrade moved one: fix the import in
 * `next-internals.ts` (or replace the use) before shipping the upgrade.
 */
describe("Next's internals (next-internals.ts)", () => {
  it("PathnameContext is still a React context", () => {
    expect(
      PathnameContext,
      "next/dist/shared/lib/hooks-client-context.shared-runtime",
    ).toBeDefined();
    expect(PathnameContext.Provider, "PathnameContext.Provider").toBeDefined();
  });

  it("usePathname() still reads PathnameContext, so a drawing's tabs mark its own screen", () => {
    function Shows() {
      return <span>{usePathname()}</span>;
    }
    const html = renderToStaticMarkup(
      <PathnameContext.Provider value="/clients/abc/projects">
        <Shows />
      </PathnameContext.Provider>,
    );
    expect(html).toBe("<span>/clients/abc/projects</span>");
  });

  it("PrefetchKind still has AUTO", () => {
    expect(
      PrefetchKind,
      "next/dist/client/components/router-reducer/router-reducer-types",
    ).toBeDefined();
    expect(PrefetchKind.AUTO).toBe("auto");
  });
});
