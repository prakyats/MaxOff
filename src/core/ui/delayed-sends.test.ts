import { describe, expect, it } from "vitest";

import { DelayedSends, UNDO_MS } from "./delayed-sends";

/** Timers you advance by hand, so every rule is checked without waiting six seconds. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    timers: {
      set: (run: () => void, ms: number) => {
        const id = next++;
        timers.set(id, { at: now + ms, run });
        return id;
      },
      clear: (id: unknown) => {
        timers.delete(id as number);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
      }
    },
    pending: () => timers.size,
  };
}

function setup() {
  const clock = fakeTimers();
  const sent: string[] = [];
  const sends = new DelayedSends((id) => sent.push(id), UNDO_MS, clock.timers);
  return { clock, sent, sends };
}

describe("DelayedSends: undo is a delayed send, nothing is recorded unless kept", () => {
  it("waits six seconds, then sends", () => {
    const { clock, sent, sends } = setup();
    sends.schedule("a");
    clock.advance(UNDO_MS - 1);
    expect(sent).toEqual([]);
    expect(sends.isWaiting("a")).toBe(true);
    clock.advance(1);
    expect(sent).toEqual(["a"]);
    expect(sends.isWaiting("a")).toBe(false);
  });

  it("undo before the send means it never happens", () => {
    const { clock, sent, sends } = setup();
    sends.schedule("a");
    expect(sends.undo("a")).toBe(true);
    clock.advance(UNDO_MS * 2);
    expect(sent).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  it("undo after the send is too late and says so", () => {
    const { clock, sends } = setup();
    sends.schedule("a");
    clock.advance(UNDO_MS);
    expect(sends.undo("a")).toBe(false);
  });

  it("gives each approval its own timer; several wait at once", () => {
    const { clock, sent, sends } = setup();
    sends.schedule("a");
    clock.advance(2000);
    sends.schedule("b");
    clock.advance(UNDO_MS - 2000);
    expect(sent).toEqual(["a"]);
    sends.undo("b");
    clock.advance(UNDO_MS);
    expect(sent).toEqual(["a"]);
  });

  it("flush sends everything still waiting at once (the app hidden, closed or left)", () => {
    const { clock, sent, sends } = setup();
    sends.schedule("a");
    sends.schedule("b");
    expect(sends.flush()).toEqual(["a", "b"]);
    expect(sent).toEqual(["a", "b"]);
    clock.advance(UNDO_MS);
    expect(sent).toEqual(["a", "b"]);
    expect(sends.flush()).toEqual([]);
  });

  it("scheduling the same row twice sends it once", () => {
    const { clock, sent, sends } = setup();
    sends.schedule("a");
    sends.schedule("a");
    clock.advance(UNDO_MS);
    expect(sent).toEqual(["a"]);
  });
});
