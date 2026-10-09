import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { followKeyboard, isTextField, KEYBOARD_LIFT_GAP, keyboardLift } from "./keyboard-lift";

describe("keyboardLift", () => {
  it("leaves the layer alone with no visual viewport or the keyboard closed", () => {
    expect(keyboardLift(800, null, 680)).toBeNull();
    expect(keyboardLift(800, { height: 800, offsetTop: 0 }, 680)).toBeNull();
    // A browser bar's few px are not a keyboard.
    expect(keyboardLift(800, { height: 740, offsetTop: 0 }, 680)).toBeNull();
  });

  it("ends the layer where the keyboard begins, no taller than what is visible", () => {
    expect(keyboardLift(800, { height: 480, offsetTop: 0 }, 680)).toEqual({
      bottom: 320,
      maxHeight: 480 - KEYBOARD_LIFT_GAP,
    });
  });

  it("keeps the layer's own cap when it is the smaller one", () => {
    expect(keyboardLift(800, { height: 480, offsetTop: 0 }, 300)).toEqual({
      bottom: 320,
      maxHeight: 300,
    });
    expect(keyboardLift(800, { height: 480, offsetTop: 0 }, null)?.maxHeight).toBe(
      480 - KEYBOARD_LIFT_GAP,
    );
  });

  it("allows for a visual viewport iOS scrolled up to keep the field in view", () => {
    expect(keyboardLift(800, { height: 480, offsetTop: 100 }, 680)).toEqual({
      bottom: 220,
      maxHeight: 480 - KEYBOARD_LIFT_GAP,
    });
  });

  it("never lifts a pinch-zoomed page: its visual viewport is small with no keyboard", () => {
    expect(keyboardLift(800, { height: 400, offsetTop: 0, scale: 2 }, 680)).toBeNull();
  });
});

describe("isTextField", () => {
  const element = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, ...extra }) as unknown as Element;

  it("is a typed input, a textarea or an editable element", () => {
    expect(isTextField(element("INPUT", { type: "text" }))).toBe(true);
    expect(isTextField(element("INPUT", { type: "date" }))).toBe(true);
    expect(isTextField(element("TEXTAREA"))).toBe(true);
    expect(isTextField(element("DIV", { isContentEditable: true }))).toBe(true);
  });

  it("is never a button, a checkbox or nothing", () => {
    expect(isTextField(element("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTextField(element("BUTTON"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

/** Just enough of a `CSSStyleDeclaration` for the lift. */
class FakeStyle {
  bottom = "";
  maxHeight = "";
  removeProperty(name: string) {
    if (name === "bottom") this.bottom = "";
    if (name === "max-height") this.maxHeight = "";
  }
}

function fakeLayer() {
  const listeners = new Map<string, (event: unknown) => void>();
  const attributes = new Map<string, string>();
  const field = { tagName: "INPUT", type: "text", scrollIntoView: vi.fn() };
  const layer = {
    style: new FakeStyle(),
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    contains: (node: unknown) => node === field,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  return { layer, field, listeners, attributes };
}

describe("followKeyboard", () => {
  let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
  let desktop = false;
  let active: unknown = null;

  beforeEach(() => {
    viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    desktop = false;
    active = null;
    const windowEvents = new EventTarget();
    vi.stubGlobal("window", {
      visualViewport: viewport,
      innerHeight: 800,
      matchMedia: () => ({ matches: desktop }),
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    });
    vi.stubGlobal("document", {
      get activeElement() {
        return active;
      },
    });
    // The layer's own `max-h-[85dvh]`.
    vi.stubGlobal("getComputedStyle", () => ({ maxHeight: "680px" }));
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const typeAway = (height: number) => {
    viewport.height = height;
    viewport.dispatchEvent(new Event("resize"));
  };

  it("lifts the layer while the keyboard is open and puts it back when it closes", () => {
    const { layer, attributes } = fakeLayer();
    const stop = followKeyboard(layer as unknown as HTMLElement, { phoneOnly: false });
    expect(layer.style.bottom).toBe("");
    typeAway(480);
    expect(layer.style.bottom).toBe("320px");
    expect(layer.style.maxHeight).toBe(`${480 - KEYBOARD_LIFT_GAP}px`);
    expect(attributes.get("data-keyboard")).toBe("open");
    typeAway(800);
    expect(layer.style.bottom).toBe("");
    expect(layer.style.maxHeight).toBe("");
    expect(attributes.has("data-keyboard")).toBe(false);
    stop();
  });

  it("scrolls the focused field into the layer's visible part", () => {
    const { layer, field, listeners } = fakeLayer();
    const stop = followKeyboard(layer as unknown as HTMLElement, { phoneOnly: false });
    active = field;
    typeAway(480);
    expect(field.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    // Moving to another field with the keyboard up reveals it too.
    field.scrollIntoView.mockClear();
    listeners.get("focusin")?.({ target: field });
    expect(field.scrollIntoView).toHaveBeenCalledTimes(1);
    stop();
  });

  it("leaves a dialog alone from md up, where it is centred, not a bottom sheet", () => {
    desktop = true;
    const { layer } = fakeLayer();
    const stop = followKeyboard(layer as unknown as HTMLElement, { phoneOnly: true });
    typeAway(480);
    expect(layer.style.bottom).toBe("");
    stop();
  });

  it("stops listening and drops the lift on unmount", () => {
    const { layer, listeners } = fakeLayer();
    const stop = followKeyboard(layer as unknown as HTMLElement, { phoneOnly: false });
    typeAway(480);
    stop();
    expect(layer.style.bottom).toBe("");
    expect(listeners.has("focusin")).toBe(false);
    typeAway(400);
    expect(layer.style.bottom).toBe("");
  });
});
