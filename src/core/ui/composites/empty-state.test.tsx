import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyRow } from "./empty-state";

/** FINAL 1 / 7: an empty section is one muted line, no heading, at most one inline action. */
describe("EmptyRow", () => {
  it("is one muted line with no heading", () => {
    const out = renderToStaticMarkup(<EmptyRow>Nothing needs you right now</EmptyRow>);
    expect(out).toContain("text-muted-foreground");
    expect(out).toContain("Nothing needs you right now");
    expect(out).not.toMatch(/<h[1-6]/);
    expect(out).not.toContain("border-dashed");
  });

  it("carries its one inline action after the words", () => {
    const out = renderToStaticMarkup(
      <EmptyRow action={<button type="button">Add stage</button>}>No stages yet.</EmptyRow>,
    );
    expect(out.indexOf("No stages yet.")).toBeLessThan(out.indexOf("Add stage"));
  });
});
