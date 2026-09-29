import { describe, expect, it, vi } from "vitest";

import { BACK_CASES, TAB_CASES, TAB_HOME, TAB_TOP_LEVEL, VIEW_CASES } from "./move-cases";
import { markLive } from "./attributes";
import {
  LIVE_ATTRIBUTE,
  PRE_HYDRATION_SCRIPT,
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
  VIEW_LINK_ATTRIBUTE,
} from "./pre-hydration";
import { NAV_PENDING_ATTRIBUTE, NAV_TARGET_ATTRIBUTE, startsNavigation } from "./progress";

const ORIGIN = "https://maxoff.test";

interface FakeLink {
  href: string;
  attributes: Record<string, string>;
  target?: string;
  /** The bar a tab sits in. */
  bar?: Record<string, string>;
}

/**
 * Runs the head script in a fake browser and taps one link: what happened to history. `below`
 * is the path of the entry beneath the current one (the Navigation API's `entries()[index-1]`).
 */
function tap(
  link: FakeLink,
  {
    pathname = "/people/1",
    index,
    below,
    standalone = true,
    live = false,
    event = {},
  }: {
    pathname?: string;
    index?: number | undefined;
    below?: string | undefined;
    standalone?: boolean;
    live?: boolean;
    event?: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>;
  } = {},
) {
  let listener: ((event: object) => void) | undefined;
  const htmlAttributes: Record<string, string> = {};
  const document = {
    addEventListener: (type: string, fn: (event: object) => void, options: unknown) => {
      // The iOS `:active` listener is passive; the tap listener runs in the capture phase.
      if (type !== "click") return;
      expect(options).toBe(true);
      listener = fn;
    },
    documentElement: {
      setAttribute: (name: string, value: string) => (htmlAttributes[name] = value),
      removeAttribute: (name: string) => delete htmlAttributes[name],
      hasAttribute: (name: string) => name in htmlAttributes,
    },
    querySelectorAll: () => [],
  };
  const history = { back: vi.fn() };
  const location = {
    href: `${ORIGIN}${pathname}`,
    pathname,
    search: "",
    origin: ORIGIN,
    replace: vi.fn(),
  };
  const entries = [...(below ? [{ url: `${ORIGIN}${below}` }] : []), { url: location.href }];
  const window = {
    matchMedia: (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }),
    navigator: {},
    ...(index === undefined
      ? {}
      : { navigation: { currentEntry: { index }, entries: () => entries.slice(-(index + 1)) } }),
  };
  new Function("window", "document", "location", "history", PRE_HYDRATION_SCRIPT)(
    window,
    document,
    location,
    history,
  );

  const attributes: Record<string, string> = {
    ...link.attributes,
    ...(live ? { [LIVE_ATTRIBUTE]: "" } : {}),
  };
  const anchor = {
    href: new URL(link.href, ORIGIN).href,
    target: link.target ?? "",
    getAttribute: (name: string) => attributes[name] ?? null,
    setAttribute: (name: string, value: string) => (attributes[name] = value),
    hasAttribute: (name: string) => name in attributes,
    closest: (selector: string) =>
      selector === `[${TAB_HOME_ATTRIBUTE}]` && link.bar
        ? { getAttribute: (name: string) => link.bar![name] ?? null }
        : null,
  };
  const preventDefault = vi.fn();
  listener!({
    button: 0,
    defaultPrevented: false,
    target: { closest: (selector: string) => (selector === "a[href]" ? anchor : null) },
    preventDefault,
    ...event,
  });

  const move = history.back.mock.calls.length
    ? "back"
    : location.replace.mock.calls.length
      ? "replace"
      : "default";
  return {
    /** Whether the tap started the navigation progress bar, and on which link. */
    progress: NAV_PENDING_ATTRIBUTE in htmlAttributes,
    target: attributes[NAV_TARGET_ATTRIBUTE],
    move,
    prevented: preventDefault.mock.calls.length > 0,
    replacedWith: location.replace.mock.calls[0]?.[0],
  };
}

const BACK: FakeLink = { href: "/people", attributes: { "data-slot": "page-back" } };
const VIEW: FakeLink = { href: "/leave/attendance", attributes: { [VIEW_LINK_ATTRIBUTE]: "" } };
const BAR = { [TAB_HOME_ATTRIBUTE]: TAB_HOME, [TAB_TOP_ATTRIBUTE]: TAB_TOP_LEVEL.join(" ") };
const tab = (href: string): FakeLink => ({ href, attributes: { [TAB_ATTRIBUTE]: "" }, bar: BAR });

describe("pre-hydration taps (task 2.8), against the shared table", () => {
  it.each(BACK_CASES)("back control: $name", ({ index, expected }) => {
    const result = tap(BACK, { index, below: index ? "/people" : undefined });
    // "parent" is a replace to the link's own href, never a push.
    expect(result.move).toBe(expected === "back" ? "back" : "replace");
    expect(result.prevented).toBe(true);
    if (expected === "parent") expect(result.replacedWith).toBe(`${ORIGIN}/people`);
  });

  it.each(VIEW_CASES)("view control: $name", ({ expected }) => {
    const result = tap(VIEW, { pathname: "/leave", index: 2, below: "/today" });
    expect(result.move).toBe(expected);
    expect(result.replacedWith).toBe(`${ORIGIN}/leave/attendance`);
  });

  it.each(TAB_CASES)("tabs: $name", ({ input, expected }) => {
    // The app knows "home is beneath" from its own push; the script reads the entry beneath.
    const result = tap(tab(input.href), {
      pathname: input.pathname,
      standalone: input.standalone,
      index: 1,
      below: input.pushedFromHome ? TAB_HOME : "/somewhere",
    });
    // A push is the link's own default navigation.
    expect(result.move).toBe(expected === null || expected === "push" ? "default" : expected);
    expect(result.prevented).toBe(expected === "back" || expected === "replace");
  });
});

describe("the navigation progress bar starts on the tap (§14.2 i)", () => {
  it("starts for any in-app link, hydrated or not, and marks the tapped one", () => {
    expect(tap({ href: "/people/2", attributes: {} })).toMatchObject({
      progress: true,
      target: `${ORIGIN}/people/2`,
    });
    expect(tap(tab("/tasks"), { pathname: "/today", index: 0, live: true })).toMatchObject({
      progress: true,
      target: `${ORIGIN}/tasks`,
    });
    expect(tap(BACK, { index: 3 })).toMatchObject({ progress: true });
  });

  it("does not start for the page you are on, another origin, a file or a new tab", () => {
    expect(tap({ href: "/people/1", attributes: {} })).toMatchObject({ progress: false });
    expect(tap({ href: "https://elsewhere.test/x", attributes: {} })).toMatchObject({
      progress: false,
    });
    expect(tap({ href: "/api/files/1", attributes: {} })).toMatchObject({ progress: false });
    expect(tap({ href: "/people/2", attributes: {}, target: "_blank" })).toMatchObject({
      progress: false,
    });
    expect(tap({ href: "/people/2", attributes: {} }, { event: { metaKey: true } })).toMatchObject({
      progress: false,
    });
  });

  it("the shared rule: somewhere else on the same origin", () => {
    const here = { origin: ORIGIN, pathname: "/leave", search: "" };
    expect(startsNavigation({ ...here, search: "?page=2" }, here)).toBe(true);
    expect(startsNavigation({ ...here, pathname: "/today" }, here)).toBe(true);
    expect(startsNavigation(here, here)).toBe(false);
    expect(startsNavigation({ ...here, origin: "https://x.test" }, here)).toBe(false);
  });
});

describe("pre-hydration taps: when the script stays out of the way", () => {
  it("leaves a link alone once React has hydrated it (data-live)", () => {
    expect(tap(BACK, { index: 3, live: true })).toMatchObject({
      move: "default",
      prevented: false,
    });
    expect(tap(VIEW, { live: true })).toMatchObject({ move: "default", prevented: false });
    expect(tap(tab("/tasks"), { pathname: "/today", index: 0, live: true })).toMatchObject({
      move: "default",
      prevented: false,
    });
  });

  it("markLive marks the element React hands it, and ignores the unmount call", () => {
    const set = vi.fn();
    markLive({ setAttribute: set } as unknown as HTMLElement);
    expect(set).toHaveBeenCalledWith(LIVE_ATTRIBUTE, "");
    expect(() => markLive(null)).not.toThrow();
  });

  it("leaves modified clicks, other buttons and new-tab targets to the browser", () => {
    for (const event of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(tap(BACK, { index: 3, event })).toMatchObject({ move: "default", prevented: false });
    }
    expect(tap({ ...VIEW, target: "_blank" })).toMatchObject({ move: "default", prevented: false });
  });

  it("leaves other links and other origins alone", () => {
    expect(tap({ href: "/people/2", attributes: {} })).toMatchObject({ move: "default" });
    expect(
      tap({ href: "https://elsewhere.test/x", attributes: { [VIEW_LINK_ATTRIBUTE]: "" } }),
    ).toMatchObject({ move: "default", prevented: false });
  });

  it("treats a tab outside the bar as an ordinary link", () => {
    const loose = { href: "/tasks", attributes: { [TAB_ATTRIBUTE]: "" } };
    expect(tap(loose, { pathname: "/today", index: 0 })).toMatchObject({ move: "default" });
  });

  it("never throws", () => {
    expect(() =>
      new Function("window", "document", "location", "history", PRE_HYDRATION_SCRIPT)(
        {},
        {},
        {},
        {},
      ),
    ).not.toThrow();
  });
});
