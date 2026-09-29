import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActionStatus } from "./action-status";
import { NETWORK_ERROR_CREATE_MESSAGE, NETWORK_ERROR_MESSAGE, SLOW_MESSAGE } from "./network-error";

/**
 * The line under a commit button (ARCHITECTURE §14.1): nothing while all is well, the slow line,
 * a failure with Retry for a state change, and for a create a failure with **no** Retry, because a
 * create whose reply was lost may already exist and a second one would be a duplicate. Rendered
 * with `react-dom/server`, as `loading-state.test.tsx` does: the markup is the whole story.
 */
// The markup escapes the apostrophes in "Couldn't": read it back as text.
const render = (action: { slow?: boolean; failed?: boolean; creates?: boolean }) =>
  renderToStaticMarkup(
    <ActionStatus
      action={{
        slow: action.slow ?? false,
        failed: action.failed ?? false,
        creates: action.creates ?? false,
        retry: () => undefined,
      }}
    />,
  ).replaceAll("&#x27;", "'");

describe("ActionStatus", () => {
  it("says nothing while all is well", () => {
    expect(render({})).toBe("");
  });

  it("says the connection is slow", () => {
    const html = render({ slow: true });
    expect(html).toContain(SLOW_MESSAGE);
    expect(html).not.toContain("Retry");
  });

  it("offers Retry when a state change never got an answer", () => {
    const html = render({ failed: true });
    expect(html).toContain(NETWORK_ERROR_MESSAGE);
    expect(html).toContain(">Retry<");
  });

  it("offers no Retry for a create, which may already have been saved", () => {
    const html = render({ failed: true, creates: true });
    expect(html).toContain(NETWORK_ERROR_CREATE_MESSAGE);
    expect(html).not.toContain("Retry");
  });
});
