import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { shouldBackOutEscape } from "@/core/ui/overlay/overlay-history";

import { isComposing, type KeyContext, keyIntent, type KeyLike, submitTarget } from "./keys";
import { ANY_COARSE_QUERY, FINE_POINTER_QUERY, isFinePointer, isMacPlatform } from "./pointer";

/**
 * The laptop keyboard rules (owner's note 2026-10-08, ARCHITECTURE §14.3), every branch: the IME,
 * a blank message, a pending send, Shift / Ctrl / ⌘ / Alt, and a laptop against touch.
 */

function key(name: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: name, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods };
}

const laptop = (field: KeyContext["field"], more: Partial<KeyContext> = {}): KeyContext => ({
  field,
  finePointer: true,
  ...more,
});
const touch = (field: KeyContext["field"], more: Partial<KeyContext> = {}): KeyContext => ({
  field,
  finePointer: false,
  ...more,
});

describe("isComposing: an IME still holds the key", () => {
  it("reads the DOM flag, React's nativeEvent and Safari's 229", () => {
    expect(isComposing(key("Enter", { isComposing: true }))).toBe(true);
    expect(isComposing(key("Enter", { nativeEvent: { isComposing: true } }))).toBe(true);
    expect(isComposing(key("Enter", { keyCode: 229 }))).toBe(true);
    expect(isComposing(key("Enter", { keyCode: 13 }))).toBe(false);
    expect(isComposing(key("Enter"))).toBe(false);
  });
});

describe("the composer (rule 1)", () => {
  const text = { value: "On my way" };

  it("on a laptop Enter sends and Shift+Enter makes a new line", () => {
    expect(keyIntent(key("Enter"), laptop("composer", text))).toBe("send");
    expect(keyIntent(key("Enter", { shiftKey: true }), laptop("composer", text))).toBe("newline");
  });

  it("on a phone Enter makes a new line; the Send button sends", () => {
    expect(keyIntent(key("Enter"), touch("composer", text))).toBe("newline");
    expect(keyIntent(key("Enter", { shiftKey: true }), touch("composer", text))).toBe("newline");
  });

  it("Ctrl+Enter and ⌘+Enter send on either (never by accident)", () => {
    for (const context of [laptop("composer", text), touch("composer", text)]) {
      expect(keyIntent(key("Enter", { ctrlKey: true }), context)).toBe("send");
      expect(keyIntent(key("Enter", { metaKey: true }), context)).toBe("send");
    }
  });

  it("Alt+Enter and Ctrl+Shift+Enter are new lines, not sends", () => {
    expect(keyIntent(key("Enter", { altKey: true }), laptop("composer", text))).toBe("newline");
    expect(
      keyIntent(key("Enter", { ctrlKey: true, shiftKey: true }), laptop("composer", text)),
    ).toBe("newline");
  });

  it("never sends while an IME is composing: the key is the IME's", () => {
    expect(keyIntent(key("Enter", { isComposing: true }), laptop("composer", text))).toBe("none");
    expect(keyIntent(key("Enter", { keyCode: 229 }), laptop("composer", text))).toBe("none");
    expect(
      keyIntent(key("Enter", { nativeEvent: { isComposing: true } }), laptop("composer", text)),
    ).toBe("none");
  });

  it("never sends an empty or whitespace-only message (and makes no new line either)", () => {
    expect(keyIntent(key("Enter"), laptop("composer", { value: "" }))).toBe("ignore");
    expect(keyIntent(key("Enter"), laptop("composer", { value: "  \n\t " }))).toBe("ignore");
    expect(keyIntent(key("Enter"), laptop("composer"))).toBe("ignore");
    expect(keyIntent(key("Enter", { ctrlKey: true }), touch("composer", { value: " " }))).toBe(
      "ignore",
    );
  });

  it("never sends while a send is pending", () => {
    expect(keyIntent(key("Enter"), laptop("composer", { ...text, pending: true }))).toBe("ignore");
    expect(
      keyIntent(key("Enter", { metaKey: true }), touch("composer", { ...text, pending: true })),
    ).toBe("ignore");
  });

  it("leaves every other key alone, Escape included (the sheet closes)", () => {
    expect(keyIntent(key("a"), laptop("composer", text))).toBe("none");
    expect(keyIntent(key("Escape"), laptop("composer", text))).toBe("none");
  });
});

describe("a one-line input in a form (rule 2)", () => {
  it("Enter submits, on a laptop and on touch (the browser's own submit)", () => {
    expect(keyIntent(key("Enter"), laptop("single"))).toBe("submit");
    expect(keyIntent(key("Enter"), touch("single"))).toBe("submit");
    expect(keyIntent(key("Enter", { shiftKey: true }), laptop("single"))).toBe("submit");
  });

  it("with Ctrl, ⌘ or Alt it is not ours; while composing or pending it never submits", () => {
    expect(keyIntent(key("Enter", { ctrlKey: true }), laptop("single"))).toBe("none");
    expect(keyIntent(key("Enter", { metaKey: true }), laptop("single"))).toBe("none");
    expect(keyIntent(key("Enter", { altKey: true }), laptop("single"))).toBe("none");
    expect(keyIntent(key("Enter", { isComposing: true }), laptop("single"))).toBe("none");
    expect(keyIntent(key("Enter"), laptop("single", { pending: true }))).toBe("ignore");
    expect(keyIntent(key("Tab"), laptop("single"))).toBe("none");
    expect(keyIntent(key("Escape"), laptop("single", { value: "x" }))).toBe("none");
  });

  it("a destructive submit is focused, never committed; no enabled button does nothing", () => {
    expect(submitTarget({ disabled: false, dataset: {} })).toBe("submit");
    expect(submitTarget({ disabled: false, dataset: { destructive: "" } })).toBe("focus");
    expect(submitTarget({ disabled: true, dataset: {} })).toBe("none");
    expect(submitTarget({ disabled: true, dataset: { destructive: "" } })).toBe("none");
    expect(submitTarget(null)).toBe("none");
  });
});

describe("a multi-line field (rule 3)", () => {
  it("Enter and Shift+Enter make a new line, on a laptop and on touch", () => {
    for (const context of [laptop("multi"), touch("multi")]) {
      expect(keyIntent(key("Enter"), context)).toBe("newline");
      expect(keyIntent(key("Enter", { shiftKey: true }), context)).toBe("newline");
    }
  });

  it("Ctrl+Enter (⌘+Enter on a Mac) submits the form", () => {
    expect(keyIntent(key("Enter", { ctrlKey: true }), laptop("multi"))).toBe("submit");
    expect(keyIntent(key("Enter", { metaKey: true }), laptop("multi"))).toBe("submit");
    expect(keyIntent(key("Enter", { ctrlKey: true }), touch("multi"))).toBe("submit");
  });

  it("Ctrl+Alt+Enter and Ctrl+Shift+Enter are new lines; composing and pending never submit", () => {
    expect(keyIntent(key("Enter", { ctrlKey: true, altKey: true }), laptop("multi"))).toBe(
      "newline",
    );
    expect(keyIntent(key("Enter", { ctrlKey: true, shiftKey: true }), laptop("multi"))).toBe(
      "newline",
    );
    expect(keyIntent(key("Enter", { ctrlKey: true, isComposing: true }), laptop("multi"))).toBe(
      "none",
    );
    expect(keyIntent(key("Enter", { ctrlKey: true }), laptop("multi", { pending: true }))).toBe(
      "ignore",
    );
  });
});

describe("a search or filter box (rule 6)", () => {
  it("Enter applies; Escape clears a box with text", () => {
    expect(keyIntent(key("Enter"), laptop("search", { value: "Ravi" }))).toBe("apply");
    expect(keyIntent(key("Enter"), touch("search", { value: "" }))).toBe("apply");
    expect(keyIntent(key("Escape"), laptop("search", { value: "Ravi" }))).toBe("clear");
  });

  it("Escape on an empty box is let through (a sheet around it closes); composing is the IME's", () => {
    expect(keyIntent(key("Escape"), laptop("search", { value: "" }))).toBe("none");
    expect(keyIntent(key("Escape"), laptop("search"))).toBe("none");
    expect(keyIntent(key("Escape", { isComposing: true }), laptop("search", { value: "R" }))).toBe(
      "none",
    );
    expect(keyIntent(key("ArrowDown"), laptop("search", { value: "R" }))).toBe("none");
  });
});

describe("a laptop: a fine pointer that hovers, and no touch anywhere", () => {
  const media =
    (answers: Record<string, boolean>) =>
    (query: string): { matches: boolean } => ({ matches: answers[query] ?? false });

  it("a mouse or trackpad and no touch screen is a laptop", () => {
    expect(isFinePointer(media({ [FINE_POINTER_QUERY]: true, [ANY_COARSE_QUERY]: false }))).toBe(
      true,
    );
  });

  it("a phone, a tablet and a touch-screen laptop are touch", () => {
    expect(isFinePointer(media({ [FINE_POINTER_QUERY]: false, [ANY_COARSE_QUERY]: true }))).toBe(
      false,
    );
    expect(isFinePointer(media({ [FINE_POINTER_QUERY]: true, [ANY_COARSE_QUERY]: true }))).toBe(
      false,
    );
    expect(isFinePointer(media({ [FINE_POINTER_QUERY]: false, [ANY_COARSE_QUERY]: false }))).toBe(
      false,
    );
  });

  it("the server (no matchMedia) is never a laptop, so no hint is in its HTML", () => {
    expect(isFinePointer(undefined)).toBe(false);
  });

  it("⌘ on a Mac, Ctrl elsewhere", () => {
    expect(isMacPlatform("macOS")).toBe(true);
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("Windows")).toBe(false);
    expect(isMacPlatform("Linux x86_64")).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});

describe("Escape backs its overlay's entry out (rule 4, overlay-history)", () => {
  const base = {
    escapePops: 1,
    pushedCount: 1,
    openCount: 0,
    onOwnEntry: true,
    backPending: false,
  };

  it("backs out a spent entry of ours left by an Escape", () => {
    expect(shouldBackOutEscape(base)).toBe(true);
    // A dialog over a sheet: Escape closes the dialog, the sheet's entry stays.
    expect(shouldBackOutEscape({ ...base, pushedCount: 2, openCount: 1 })).toBe(true);
  });

  it("never when nothing is owed, nothing is spare, the entry is not ours, or a back is in flight", () => {
    expect(shouldBackOutEscape({ ...base, escapePops: 0 })).toBe(false);
    // "Discard changes?" took the closed layer's place: the count is unchanged.
    expect(shouldBackOutEscape({ ...base, openCount: 1 })).toBe(false);
    expect(shouldBackOutEscape({ ...base, onOwnEntry: false })).toBe(false);
    expect(shouldBackOutEscape({ ...base, backPending: true })).toBe(false);
  });
});

describe("the shared controls carry the rules (wiring)", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("Dialog and Sheet route Escape and the opening focus through the layer rules; AlertDialog Escape", () => {
    for (const file of ["dialog", "sheet"]) {
      const source = read(`../primitives/${file}.tsx`);
      expect(source, file).toContain("onLayerEscape(event, onEscapeKeyDown)");
      expect(source, file).toContain("onLayerOpenFocus(event, onOpenAutoFocus)");
    }
    expect(read("../primitives/alert-dialog.tsx")).toContain(
      "onLayerEscape(event, onEscapeKeyDown)",
    );
  });

  it("an Escape is noted for overlay-history, after the caller's own handler", () => {
    const layer = read("./layer.ts");
    expect(layer).toContain("callerHandler?.(event);");
    expect(layer).toContain("noteEscape(event);");
  });

  it("Input and Textarea never hand autoFocus to the DOM: they focus on a laptop only", () => {
    for (const file of ["input", "textarea"]) {
      const source = read(`../primitives/${file}.tsx`);
      expect(source, file).toContain("if (autoFocus && finePointer()) own.current?.focus();");
      expect(source, file).not.toMatch(/autoFocus=\{/);
    }
  });

  it("the comment composer decides its keys with keyIntent and never hints on touch", () => {
    const composer = read("../../../modules/tasks/components/task-chat-composer.tsx");
    expect(composer).toContain('field: "composer"');
    expect(composer).toContain("const laptop = useFinePointer();");
  });
});
