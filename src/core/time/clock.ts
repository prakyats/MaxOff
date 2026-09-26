/**
 * The wall clock, in its own file so a browser module that only needs "now" (refresh on return)
 * does not bring date-fns into every screen's first load (task 2.8). `ist.ts` re-exports it.
 */

/** Returns the current instant. Injected so tests never depend on the wall clock. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
