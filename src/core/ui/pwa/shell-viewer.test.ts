import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetShellViewer, postShellViewer, SHELL_VIEWER_MESSAGE } from "./shell-viewer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the instant skeleton's viewer", () => {
  it("names the role only, or nobody", () => {
    const postMessage = vi.fn();
    postShellViewer({ postMessage }, "admin");
    postShellViewer({ postMessage }, null);
    expect(postMessage.mock.calls).toEqual([
      [{ type: SHELL_VIEWER_MESSAGE, viewer: "admin" }],
      [{ type: SHELL_VIEWER_MESSAGE, viewer: null }],
    ]);
  });

  it("sign-out and a signed-out page tell the page's worker nobody is signed in", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage } } });
    forgetShellViewer();
    expect(postMessage).toHaveBeenCalledWith({ type: SHELL_VIEWER_MESSAGE, viewer: null });
  });

  it("does nothing without a worker in charge, or without service workers", () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    expect(() => forgetShellViewer()).not.toThrow();
    vi.stubGlobal("navigator", {});
    expect(() => forgetShellViewer()).not.toThrow();
  });
});
