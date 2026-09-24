/**
 * **Undo is a delayed send; nothing is recorded unless kept** (WORKFLOWS §1 "Settled in 2.4").
 *
 * A single Approve does not call the server straight away: it waits `delayMs` (the Undo toast's
 * life) and then sends. Undo before that simply drops it, so no function ran and no history row
 * exists. Each id has its own timer; several can wait at once. `flush()` sends everything still
 * waiting at once: the page going to the background (`visibilitychange` hidden), being left
 * (`pagehide`) or unmounted (a navigation) must never lose an approval.
 *
 * Plain TypeScript with injectable timers so the rules are unit-tested; `useDelayedSends`
 * (`composites/approval-group.tsx`) is the React wrapper.
 */
export const UNDO_MS = 6000;

type Timers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class DelayedSends {
  private readonly waiting = new Map<string, unknown>();

  constructor(
    private readonly send: (id: string) => void,
    private readonly delayMs: number = UNDO_MS,
    private readonly timers: Timers = browserTimers,
  ) {}

  /** Starts the countdown for `id`. Scheduling an id that is already waiting restarts nothing. */
  schedule(id: string): void {
    if (this.waiting.has(id)) return;
    this.waiting.set(
      id,
      this.timers.set(() => this.fire(id), this.delayMs),
    );
  }

  /** Undo: true when the send was still waiting and is now dropped. */
  undo(id: string): boolean {
    const handle = this.waiting.get(id);
    if (handle === undefined) return false;
    this.timers.clear(handle);
    this.waiting.delete(id);
    return true;
  }

  /** Sends every waiting id now. Returns the ids sent. */
  flush(): string[] {
    const ids = [...this.waiting.keys()];
    for (const id of ids) this.fire(id);
    return ids;
  }

  isWaiting(id: string): boolean {
    return this.waiting.has(id);
  }

  private fire(id: string): void {
    const handle = this.waiting.get(id);
    if (handle === undefined) return;
    this.timers.clear(handle);
    this.waiting.delete(id);
    this.send(id);
  }
}
