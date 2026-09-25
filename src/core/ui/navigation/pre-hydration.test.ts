import { describe, expect, it, vi } from "vitest";

import { BACK_CASES, TAB_CASES, TAB_HOME, TAB_TOP_LEVEL, VIEW_CASES } from "./move-cases";
import {
  HYDRATED_ATTRIBUTE,
  PRE_HYDRATION_SCRIPT,
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
  VIEW_LINK_ATTRIBUTE,
} from "./pre-hydration";

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
    hydrated = false,
    event = {},
  }: {
    pathname?: string;
    index?: number | undefined;
    below?: string | undefined;
    standalone?: boolean;
    hydrated?: boolean;
    event?: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>;
  } = {},
) {
  let listener: ((event: object) => void) | undefined;
  const html = new Set(hydrated ? [HYDRATED_ATTRIBUTE] : []);
  const document = {
    documentElement: { hasAttribute: (name: string) => html.has(name) },
    addEventListener: (_: string, fn: (event: object) => void, capture: boolean) => {
      expect(capture).toBe(true);
      listener = fn;
    },
  };
  const history = { back: vi.fn() };
  const location = { href: `${ORIGIN}${pathname}`, pathname, origin: ORIGIN, replace: vi.fn() };
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

  const anchor = {
    href: new URL(link.href, ORIGIN).href,
    target: link.target ?? "",
    getAttribute: (name: string) => link.attributes[name] ?? null,
    hasAttribute: (name: string) => name in link.attributes,
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

describe("pre-hydration taps: when the script stays out of the way", () => {
  it("steps aside once the document is hydrated", () => {
    expect(tap(BACK, { index: 3, hydrated: true })).toMatchObject({
      move: "default",
      prevented: false,
    });
    expect(tap(VIEW, { hydrated: true })).toMatchObject({ move: "default", prevented: false });
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
