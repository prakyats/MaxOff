import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BACK_CASES, TAB_CASES, TAB_HOME, TAB_TOP_LEVEL, VIEW_CASES } from "./move-cases";
import { markLive } from "./attributes";
import { BACK_FROM_ATTRIBUTE } from "./attributes";
import {
  HEADER_BELL_SLOT,
  HOLD_TAP_ATTRIBUTE,
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
  paths,
  standalone = true,
}: {
  pathname?: string;
  index?: number | undefined;
  below?: string | undefined;
  /** The entries' pathnames up to this one (null: no Navigation API); overrides `index`. */
  paths?: readonly (string | null)[] | null | undefined;
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
  const history = { back: vi.fn(), go: vi.fn() };
  const location = {
    href: `${ORIGIN}${pathname}`,
    pathname,
    search: "",
    origin: ORIGIN,
    replace: vi.fn(),
    assign: vi.fn(),
  };
  const entries =
    paths === undefined
      ? [...(below ? [{ url: `${ORIGIN}${below}` }] : []), { url: location.href }]
      : (paths ?? []).map((path) => ({ url: path === null ? null : `${ORIGIN}${path}` }));
  const at = paths === undefined ? index : paths === null ? undefined : paths.length - 1;
  const window = {
    matchMedia: (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }),
    navigator: {},
    ...(at === undefined
      ? {}
      : {
          navigation: {
            currentEntry: { index: at },
            entries: () => (paths === undefined ? entries.slice(-(at + 1)) : entries),
          },
        }),
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

  /** A button marked `data-hold-tap` (the calendar's handle, a day box), and a tap on it. */
  const buttonFor = (
    name: string,
    live: boolean,
    { type = "button", within = null }: { type?: string; within?: string | null } = {},
  ) => {
    const attributes: Record<string, string> = {
      [HOLD_TAP_ATTRIBUTE]: name,
      ...(live ? { [LIVE_ATTRIBUTE]: "" } : {}),
    };
    const button = {
      isConnected: true,
      visible: true,
      type,
      // `within`: the ancestor it sits in (`form`, a commit footer's `data-slot`), if any.
      closest: (selector: string) =>
        within !== null && selector.split(",").some((part) => part === within) ? {} : null,
      getAttribute: (key: string) => attributes[key] ?? null,
      setAttribute: (key: string, value: string) => (attributes[key] = value),
      hasAttribute: (key: string) => key in attributes,
      getClientRects: () => (button.visible ? [{}] : []),
      // A replayed click is a real click: the script's listener hears it again.
      click: vi.fn((): { prevented: boolean; stopped: boolean } => tapButton(button)),
    };
    return button;
  };
  /** `inner`: the tap lands on another control inside the marked button (its own answers). */
  const tapButton = (button: ReturnType<typeof buttonFor>, inner: object | null = null) => {
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    listener!({
      button: 0,
      defaultPrevented: false,
      target: {
        closest: (selector: string) =>
          selector === `[${HOLD_TAP_ATTRIBUTE}]`
            ? button
            : selector.startsWith("button,")
              ? (inner ?? button)
              : null,
      },
      preventDefault,
      stopImmediatePropagation,
    });
    return {
      prevented: preventDefault.mock.calls.length > 0,
      stopped: stopImmediatePropagation.mock.calls.length > 0,
    };
  };

  const move = () =>
    history.back.mock.calls.length || history.go.mock.calls.length
      ? "back"
      : location.replace.mock.calls.length
        ? "replace"
        : location.assign.mock.calls.length
          ? "push"
          : "none";

  return {
    anchorFor,
    tap,
    buttonFor,
    tapButton,
    findable,
    /** The page's address (a test may change it, as a view switch does). */
    location,
    /** The full-load move made so far (none while a tap is held). */
    move,
    /** Whether each tap so far was prevented. */
    prevented,
    /** Whether the progress bar has started, and on which link. */
    progress: () => NAV_PENDING_ATTRIBUTE in htmlAttributes,
    target: () => lastTapped?.getAttribute(NAV_TARGET_ATTRIBUTE) ?? undefined,
    replacedWith: () => location.replace.mock.calls[0]?.[0],
    /** How far back the full-load back went (`history.go(-n)`). */
    wentBack: () => history.go.mock.calls[0]?.[0],
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
    wentBack: doc.wentBack(),
  };
}

const BACK: FakeLink = { href: "/people", attributes: { "data-slot": "page-back" } };
const BELL: FakeLink = { href: "/notifications", attributes: { "data-slot": HEADER_BELL_SLOT } };
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
  it.each(BACK_CASES)("back control: $name", ({ paths, parent, from = [], expected }) => {
    const link: FakeLink = {
      href: parent,
      attributes: {
        "data-slot": "page-back",
        ...(from.length ? { [BACK_FROM_ATTRIBUTE]: from.join(" ") } : {}),
      },
    };
    const result = tapAndWait(link, {
      pathname: paths?.[paths.length - 1] ?? "/somewhere",
      paths,
    });
    // The parent is a replace to the link's own href, never a push; back goes `expected` steps.
    expect(result.move).toBe(expected > 0 ? "back" : "replace");
    expect(result.prevented).toBe(true);
    if (expected > 0) expect(result.wentBack).toBe(-expected);
    else expect(result.replacedWith).toBe(`${ORIGIN}${parent}`);
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
    // A tab's back is one step: never `history.go(0)`, which reloads the page.
    if (result.move === "back") expect(result.wentBack).toBe(-1);
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
    const doc = page({ paths: ["/people", "/people/1"] });
    const anchor = doc.anchorFor(BACK, false);
    doc.tap(anchor);
    doc.tap(anchor);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS + 100);
    expect(doc.prevented).toEqual([true, true]);
    expect(doc.move()).toBe("back");
    // Exactly one history move, one step.
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(doc.move()).toBe("back");
    expect(doc.wentBack()).toBe(-1);
  });

  it("holds the title bar's bell the same way, and its fallback is a push (issue #49)", () => {
    const held = page({ pathname: "/my-day", index: 0 });
    const bell = held.anchorFor(BELL, false);
    held.tap(bell);
    expect(held.prevented).toEqual([true]);
    expect(held.progress()).toBe(true);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS - 300);
    expect(held.move()).toBe("none");
    markLive(bell as unknown as HTMLElement);
    vi.advanceTimersByTime(100);
    expect(bell.click).toHaveBeenCalledTimes(1);
    expect(held.prevented).toEqual([true, false]);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(held.move()).toBe("none");

    // Without hydration: the browser's own push, as the tap would have been, once the wait is over.
    const alone = page({ pathname: "/my-day", index: 0 });
    alone.tap(alone.anchorFor(BELL, false));
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS + 100);
    expect(alone.move()).toBe("push");
    expect(alone.assignedTo()).toBe(`${ORIGIN}/notifications`);
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

describe("a tap on a marked button before hydration is held, never lost (v2.0 X3 (d))", () => {
  it("stops it before React, waits, and replays it once React has the button: one toggle", () => {
    const doc = page();
    const handle = doc.buttonFor("calendar-handle", false);
    expect(doc.tapButton(handle)).toEqual({ prevented: true, stopped: true });
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS - 300);
    expect(handle.click).not.toHaveBeenCalled();

    markLive(handle as unknown as HTMLElement);
    vi.advanceTimersByTime(100);
    expect(handle.click).toHaveBeenCalledTimes(1);
    // The replayed click reaches the app: the script now leaves it alone.
    expect(handle.click.mock.results[0]?.value).toEqual({ prevented: false, stopped: false });
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(handle.click).toHaveBeenCalledTimes(1);
    expect(doc.move()).toBe("none");
  });

  it("leaves a button React already has alone", () => {
    const doc = page();
    expect(doc.tapButton(doc.buttonFor("calendar-handle", true))).toEqual({
      prevented: false,
      stopped: false,
    });
  });

  it("lets the tap go if React never takes the button within the wait (no load: it is a button)", () => {
    const doc = page();
    const day = doc.buttonFor("day:2026-11-09", false);
    doc.tapButton(day);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS + 100);
    markLive(day as unknown as HTMLElement);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(day.click).not.toHaveBeenCalled();
    expect(doc.move()).toBe("none");
  });

  it("finds the visible button of the same name when React swapped the tapped one", () => {
    const doc = page();
    const tapped = doc.buttonFor("day:2026-11-09", false);
    doc.tapButton(tapped);
    tapped.isConnected = false;
    const hidden = doc.buttonFor("day:2026-11-09", true);
    hidden.visible = false;
    const shown = doc.buttonFor("day:2026-11-09", true);
    doc.findable.push(hidden as never, shown as never);
    vi.advanceTimersByTime(100);
    expect(shown.click).toHaveBeenCalledTimes(1);
    expect(hidden.click).not.toHaveBeenCalled();
    expect(tapped.click).not.toHaveBeenCalled();
  });

  it("never holds a submit button, or one in a form or a commit footer, marked or not", () => {
    for (const options of [
      { type: "submit" },
      { within: "form" },
      { within: "[data-slot=sticky-actions]" },
      { within: "[data-slot=dialog-footer]" },
      { within: "[data-slot=sheet-footer]" },
      { within: "[data-slot=alert-dialog-footer]" },
      { within: "[data-slot=detail-sheet-actions]" },
      { within: "[data-slot=review-sheet-actions]" },
      { within: "[data-slot=page-actions]" },
    ]) {
      const doc = page();
      const save = doc.buttonFor("save", false, options);
      expect(doc.tapButton(save), JSON.stringify(options)).toEqual({
        prevented: false,
        stopped: false,
      });
      markLive(save as unknown as HTMLElement);
      vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
      expect(save.click).not.toHaveBeenCalled();
    }
  });

  it("never swallows a tap on another control inside a marked one (X6 review)", () => {
    const doc = page();
    const day = doc.buttonFor("day:2026-11-09", false);
    expect(doc.tapButton(day, { inner: "a link in the day" })).toEqual({
      prevented: false,
      stopped: false,
    });
    markLive(day as unknown as HTMLElement);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(day.click).not.toHaveBeenCalled();
  });

  it("drops the replay when the button it finds is a commit (X6 review: the target, not only the tap)", () => {
    const doc = page();
    const tapped = doc.buttonFor("day:2026-11-09", false);
    doc.tapButton(tapped);
    tapped.isConnected = false;
    const swapped = doc.buttonFor("day:2026-11-09", true, { within: "[data-slot=sheet-footer]" });
    doc.findable.push(swapped as never);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(swapped.click).not.toHaveBeenCalled();
    expect(tapped.click).not.toHaveBeenCalled();
  });

  it("a link tap supersedes a held button tap: the link's move happens (X6 review H2)", () => {
    const doc = page();
    doc.tapButton(doc.buttonFor("calendar-handle", false));
    // The bell, before hydration: held, then the app's push (here, its full-load fallback).
    doc.tap(doc.anchorFor(BELL, false));
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS + 100);
    expect(doc.move()).toBe("push");
  });

  it("drops the hold once a click reaches the button live: React answered it, no replay", () => {
    const doc = page();
    const handle = doc.buttonFor("calendar-handle", false);
    doc.tapButton(handle);
    markLive(handle as unknown as HTMLElement);
    // A real tap lands on the live button before the poll's next turn.
    expect(doc.tapButton(handle)).toEqual({ prevented: false, stopped: false });
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(handle.click).not.toHaveBeenCalled();
  });

  it("drops the hold when the address changes (a week→month switch): no click on the new screen", () => {
    const doc = page();
    const day = doc.buttonFor("day:2026-11-09", false);
    doc.tapButton(day);
    doc.location.href = `${doc.location.href}?view=month`;
    markLive(day as unknown as HTMLElement);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(day.click).not.toHaveBeenCalled();
  });

  it("finds nothing when no swapped button of the name is visible: never a hidden copy", () => {
    const doc = page();
    const tapped = doc.buttonFor("day:2026-11-09", false);
    doc.tapButton(tapped);
    tapped.isConnected = false;
    const hidden = doc.buttonFor("day:2026-11-09", true);
    hidden.visible = false;
    doc.findable.push(hidden as never);
    vi.advanceTimersByTime(PRE_HYDRATION_WAIT_MS);
    expect(hidden.click).not.toHaveBeenCalled();
  });

  it("ignores a second tap while one is held: one toggle, not two", () => {
    const doc = page();
    const handle = doc.buttonFor("calendar-handle", false);
    doc.tapButton(handle);
    expect(doc.tapButton(handle)).toEqual({ prevented: true, stopped: true });
    markLive(handle as unknown as HTMLElement);
    vi.advanceTimersByTime(100);
    expect(handle.click).toHaveBeenCalledTimes(1);
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
    expect(tapAndWait(BELL, { pathname: "/my-day", index: 0, live: true })).toMatchObject({
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
