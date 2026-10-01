import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BACK_CASES, TAB_CASES, TAB_HOME, TAB_TOP_LEVEL, VIEW_CASES } from "./move-cases";
import { markLive } from "./attributes";
import {
  LIVE_ATTRIBUTE,
  PRE_HYDRATION_SCRIPT,
  PRE_HYDRATION_WAIT_MS,
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

interface FakeAnchor {
  href: string;
  target: string;
  isConnected: boolean;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  hasAttribute: (name: string) => boolean;
  closest: (selector: string) => unknown;
  click: () => void;
}

/**
 * One document with the script installed: taps on it, the moves it made and the links the
 * script can find again (`document.querySelectorAll`).
 */
function page({
  pathname = "/people/1",
  index,
  below,
  standalone = true,
}: {
  pathname?: string;
  index?: number | undefined;
  below?: string | undefined;
  standalone?: boolean;
} = {}) {
  let listener: ((event: object) => void) | undefined;
  const htmlAttributes: Record<string, string> = {};
  const findable: FakeAnchor[] = [];
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
    querySelectorAll: (selector: string) =>
      selector.startsWith(`[${NAV_TARGET_ATTRIBUTE}]`) ? [] : findable,
  };
  const history = { back: vi.fn() };
  const location = {
    href: `${ORIGIN}${pathname}`,
    pathname,
    search: "",
    origin: ORIGIN,
    replace: vi.fn(),
    assign: vi.fn(),
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

  const anchorFor = (link: FakeLink, live: boolean): FakeAnchor => {
    const attributes: Record<string, string> = {
      ...link.attributes,
      ...(live ? { [LIVE_ATTRIBUTE]: "" } : {}),
    };
    const anchor: FakeAnchor = {
      href: new URL(link.href, ORIGIN).href,
      target: link.target ?? "",
      isConnected: true,
      getAttribute: (name) => attributes[name] ?? null,
      setAttribute: (name, value) => (attributes[name] = value),
      hasAttribute: (name) => name in attributes,
      closest: (selector) =>
        selector === `[${TAB_HOME_ATTRIBUTE}]` && link.bar
          ? { getAttribute: (name: string) => link.bar![name] ?? null }
          : null,
      // A replayed click is a real click: the script's listener hears it again.
      click: vi.fn(() => tap(anchor)),
    };
    return anchor;
  };

  const prevented: boolean[] = [];
  let lastTapped: FakeAnchor | undefined;
  const tap = (
    anchor: FakeAnchor,
    event: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {},
  ) => {
    const preventDefault = vi.fn();
    lastTapped = anchor;
    listener!({
      button: 0,
      defaultPrevented: false,
      target: { closest: (selector: string) => (selector === "a[href]" ? anchor : null) },
      preventDefault,
      ...event,
    });
    prevented.push(preventDefault.mock.calls.length > 0);
  };

  const move = () =>
    history.back.mock.calls.length
      ? "back"
      : location.replace.mock.calls.length
        ? "replace"
        : location.assign.mock.calls.length
          ? "push"
          : "none";

  return {
    anchorFor,
    tap,
    findable,
    /** The full-load move made so far (none while a tap is held). */
    move,
    /** Whether each tap so far was prevented. */
    prevented,
    /** Whether the progress bar has started, and on which link. */
    progress: () => NAV_PENDING_ATTRIBUTE in htmlAttributes,
    target: () => lastTapped?.getAttribute(NAV_TARGET_ATTRIBUTE) ?? undefined,
    replacedWith: () => location.replace.mock.calls[0]?.[0],
    assignedTo: () => location.assign.mock.calls[0]?.[0],
  };
}

/** One tap on a link React never hydrates: what the script does once it stops waiting. */
function tapAndWait(
  link: FakeLink,
  options: Parameters<typeof page>[0] & { live?: boolean; event?: object } = {},
) {
  const { live = false, event, ...rest } = options;
  const doc = page(rest);
  const anchor = doc.anchorFor(link, live);
  doc.tap(anchor, event);
  const immediately = doc.move();
  vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
  return {
    immediately,
    move: doc.move(),
    prevented: doc.prevented[0],
    progress: doc.progress(),
    target: doc.target(),
    replacedWith: doc.replacedWith(),
    assignedTo: doc.assignedTo(),
  };
}

const BACK: FakeLink = { href: "/people", attributes: { "data-slot": "page-back" } };
const VIEW: FakeLink = { href: "/leave/attendance", attributes: { [VIEW_LINK_ATTRIBUTE]: "" } };
const BAR = { [TAB_HOME_ATTRIBUTE]: TAB_HOME, [TAB_TOP_ATTRIBUTE]: TAB_TOP_LEVEL.join(" ") };
const tab = (href: string): FakeLink => ({ href, attributes: { [TAB_ATTRIBUTE]: "" }, bar: BAR });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pre-hydration taps (task 2.8), against the shared table", () => {
  it.each(BACK_CASES)("back control: $name", ({ index, expected }) => {
    const result = tapAndWait(BACK, { index, below: index ? "/people" : undefined });
    // "parent" is a replace to the link's own href, never a push.
    expect(result.move).toBe(expected === "back" ? "back" : "replace");
    expect(result.prevented).toBe(true);
    if (expected === "parent") expect(result.replacedWith).toBe(`${ORIGIN}/people`);
  });

  it.each(VIEW_CASES)("view control: $name", ({ expected }) => {
    const result = tapAndWait(VIEW, { pathname: "/leave", index: 2, below: "/today" });
    expect(result.move).toBe(expected);
    expect(result.replacedWith).toBe(`${ORIGIN}/leave/attendance`);
  });

  it.each(TAB_CASES)("tabs: $name", ({ input, expected }) => {
    // The app knows "home is beneath" from its own push; the script reads the entry beneath.
    const result = tapAndWait(tab(input.href), {
      pathname: input.pathname,
      standalone: input.standalone,
      index: 1,
      below: input.pushedFromHome ? TAB_HOME : "/somewhere",
    });
    // A push is a document load of the tab, as the browser's own navigation would have been.
    expect(result.move).toBe(expected === null || expected === "push" ? "push" : expected);
    if (result.move === "push") expect(result.assignedTo).toBe(`${ORIGIN}${input.href}`);
    expect(result.prevented).toBe(true);
  });
});

describe("a tap before hydration is held for the app (owner 2026-10-01)", () => {
  it("makes no move while it waits, and hands the click to the link once React has it", () => {
    const doc = page({ index: 3 });
    const anchor = doc.anchorFor(BACK, false);
    doc.tap(anchor);
    expect(doc.prevented).toEqual([true]);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS - 300);
    expect(doc.move()).toBe("none");

    markLive(anchor as unknown as HTMLElement);
    vi.advanceTimersByTime(100);
    // Replayed once, as a real click the script now leaves alone: the app makes the move.
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(doc.prevented).toEqual([true, false]);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(doc.move()).toBe("none");
    expect(doc.progress()).toBe(true);
  });

  it("falls back to the full load only once the wait is over", () => {
    const doc = page({ index: 0 });
    doc.tap(doc.anchorFor(BACK, false));
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS - 50);
    expect(doc.move()).toBe("none");
    vi.advanceTimersByTime(100);
    expect(doc.move()).toBe("replace");
    expect(doc.replacedWith()).toBe(`${ORIGIN}/people`);
  });

  it("finds the link again when React swapped it while streaming (the same kind and address)", () => {
    const doc = page({ index: 3 });
    const tapped = doc.anchorFor(BACK, false);
    doc.tap(tapped);
    tapped.isConnected = false;
    const other = doc.anchorFor({ ...BACK, href: "/elsewhere" }, true);
    const replacement = doc.anchorFor(BACK, true);
    doc.findable.push(other, replacement);
    vi.advanceTimersByTime(100);
    expect(replacement.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
    expect(tapped.click).not.toHaveBeenCalled();
    expect(doc.move()).toBe("none");
  });

  it("ignores a second tap while one is held: one move, not two", () => {
    const doc = page({ index: 3 });
    const anchor = doc.anchorFor(BACK, false);
    doc.tap(anchor);
    doc.tap(anchor);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS + 100);
    expect(doc.prevented).toEqual([true, true]);
    expect(doc.move()).toBe("back");
    // Exactly one history move.
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(doc.move()).toBe("back");
  });

  it("holds a view control and a tab the same way", () => {
    const view = page({ pathname: "/leave", index: 2, below: "/today" });
    const viewLink = view.anchorFor(VIEW, false);
    view.tap(viewLink);
    markLive(viewLink as unknown as HTMLElement);
    vi.advanceTimersByTime(100);
    expect(viewLink.click).toHaveBeenCalledTimes(1);
    expect(view.move()).toBe("none");

    const bar = page({ pathname: TAB_HOME, index: 0 });
    const tabLink = bar.anchorFor(tab("/tasks"), false);
    bar.tap(tabLink);
    markLive(tabLink as unknown as HTMLElement);
    vi.advanceTimersByTime(100);
    expect(tabLink.click).toHaveBeenCalledTimes(1);
    expect(bar.move()).toBe("none");
  });
});

describe("the navigation progress bar starts on the tap (§14.2 i)", () => {
  it("starts for any in-app link, hydrated or not, and marks the tapped one", () => {
    expect(tapAndWait({ href: "/people/2", attributes: {} })).toMatchObject({
      progress: true,
      target: `${ORIGIN}/people/2`,
    });
    expect(tapAndWait(tab("/tasks"), { pathname: "/today", index: 0, live: true })).toMatchObject({
      progress: true,
      target: `${ORIGIN}/tasks`,
    });
    expect(tapAndWait(BACK, { index: 3 })).toMatchObject({ progress: true });
  });

  it("does not start for the page you are on, another origin, a file or a new tab", () => {
    expect(tapAndWait({ href: "/people/1", attributes: {} })).toMatchObject({ progress: false });
    expect(tapAndWait({ href: "https://elsewhere.test/x", attributes: {} })).toMatchObject({
      progress: false,
    });
    expect(tapAndWait({ href: "/api/files/1", attributes: {} })).toMatchObject({
      progress: false,
    });
    expect(tapAndWait({ href: "/people/2", attributes: {}, target: "_blank" })).toMatchObject({
      progress: false,
    });
    expect(
      tapAndWait({ href: "/people/2", attributes: {} }, { event: { metaKey: true } }),
    ).toMatchObject({ progress: false });
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
    expect(tapAndWait(BACK, { index: 3, live: true })).toMatchObject({
      move: "none",
      prevented: false,
    });
    expect(tapAndWait(VIEW, { live: true })).toMatchObject({ move: "none", prevented: false });
    expect(tapAndWait(tab("/tasks"), { pathname: "/today", index: 0, live: true })).toMatchObject({
      move: "none",
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
      expect(tapAndWait(BACK, { index: 3, event })).toMatchObject({
        move: "none",
        prevented: false,
      });
    }
    expect(tapAndWait({ ...VIEW, target: "_blank" })).toMatchObject({
      move: "none",
      prevented: false,
    });
  });

  it("leaves other links and other origins alone", () => {
    expect(tapAndWait({ href: "/people/2", attributes: {} })).toMatchObject({
      move: "none",
      prevented: false,
    });
    expect(
      tapAndWait({ href: "https://elsewhere.test/x", attributes: { [VIEW_LINK_ATTRIBUTE]: "" } }),
    ).toMatchObject({ move: "none", prevented: false });
  });

  it("treats a tab outside the bar as an ordinary link", () => {
    const loose = { href: "/tasks", attributes: { [TAB_ATTRIBUTE]: "" } };
    expect(tapAndWait(loose, { pathname: "/today", index: 0 })).toMatchObject({
      move: "none",
      prevented: false,
    });
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
