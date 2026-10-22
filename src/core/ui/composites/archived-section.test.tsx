import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArchivedRow, ArchivedSection } from "./list-rows";

/** V5b-0 item 9: archived rows stay reachable at the foot of every list with Archive. */
describe("ArchivedSection", () => {
  it("is hidden when nothing is archived", () => {
    expect(renderToStaticMarkup(<ArchivedSection count={0}>{null}</ArchivedSection>)).toBe("");
  });

  it('is a collapsed "Archived (n)", a native details (a view control, no history)', () => {
    const out = renderToStaticMarkup(
      <ArchivedSection count={2}>
        <ArchivedRow name="Editor" kind="Job title" onRestore={() => {}} />
      </ArchivedSection>,
    );
    expect(out).toMatch(/^<details/);
    expect(out).not.toMatch(/<details[^>]*\sopen/);
    expect(out).toContain("Archived (2)");
  });

  it("offers Restore, and Delete only when the caller passes it (the Owner)", () => {
    const admin = renderToStaticMarkup(
      <ArchivedRow name="Editor" kind="Job title" onRestore={() => {}} />,
    );
    expect(admin).toContain('aria-label="Restore Editor"');
    expect(admin).not.toContain("Delete Editor");
    const owner = renderToStaticMarkup(
      <ArchivedRow name="Editor" kind="Job title" onRestore={() => {}} onDelete={() => {}} />,
    );
    expect(owner).toContain('aria-label="Delete Editor"');
  });
});
