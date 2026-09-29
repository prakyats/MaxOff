import { describe, expect, it, vi } from "vitest";

import { OFFLINE_BACK_SLOT, OFFLINE_RETRY_SCRIPT, OFFLINE_RETRY_SLOT } from "./offline-retry";

/**
 * Runs the inline script against just enough of a page: the button, the line, `window` and a
 * `location` served at `/login`, the address whose navigation failed.
 */
function page() {
  const listeners: Record<string, () => void> = {};
  let onClick = () => {};
  const button = {
    attributes: new Map<string, string>(),
    disabled: false,
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
    addEventListener(_type: string, handler: () => void) {
      onClick = handler;
    },
  };
  const line = { hidden: true };
  const location = { href: "https://app.maxoff.in/login", replace: vi.fn() };
  const document = {
    querySelector: (selector: string) =>
      selector.includes(OFFLINE_RETRY_SLOT)
        ? button
        : selector.includes(OFFLINE_BACK_SLOT)
          ? line
          : null,
  };
  const window = {
    addEventListener: (type: string, handler: () => void) => {
      listeners[type] = handler;
    },
  };
  new Function("document", "window", "location", OFFLINE_RETRY_SCRIPT)(document, window, location);
  return {
    button,
    line,
    location,
    click: () => onClick(),
    online: () => listeners.online?.(),
    fire: (type: string) => listeners[type]?.(),
  };
}

describe("the offline page's way back", () => {
  it("loads the address again on Try again, pending, and only once", () => {
    const { button, line, location, click } = page();
    click();
    click();
    expect(location.replace).toHaveBeenCalledTimes(1);
    expect(location.replace).toHaveBeenCalledWith("https://app.maxoff.in/login");
    expect(button.attributes.get("data-pending")).toBe("");
    expect(button.disabled).toBe(true);
    expect(line.hidden, "the back-online line is for the event only").toBe(true);
  });

  it("loads the address again by itself once back online, and says so", () => {
    const { line, location, click, online } = page();
    online();
    online();
    click();
    expect(location.replace).toHaveBeenCalledTimes(1);
    expect(line.hidden).toBe(false);
  });

  it("never takes over a navigation that is already leaving the page", () => {
    // Another address is loading: its navigation must win, whatever the connection does.
    const { location, click, online, fire } = page();
    fire("beforeunload");
    online();
    click();
    expect(location.replace).not.toHaveBeenCalled();
    // Back from the back/forward cache, the page works again.
    fire("pageshow");
    click();
    expect(location.replace).toHaveBeenCalledTimes(1);
  });

  it("goes back to the address it was served at, even once the address bar says /offline", () => {
    // Next's router rewrites the address bar to the page's own route when it hydrates.
    const { location, click } = page();
    location.href = "https://app.maxoff.in/offline";
    click();
    expect(location.replace).toHaveBeenCalledWith("https://app.maxoff.in/login");
  });
});
