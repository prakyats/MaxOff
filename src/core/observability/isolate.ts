/**
 * What this isolate has done so far (unit P, 2026-10-15). A Worker isolate is created on its
 * first request and serves many after it; the first one pays the cold start (the bundle's
 * parse and the Next server's start-up), which on staging measured in seconds where a warm
 * request takes a few hundred ms. The proxy puts these two numbers on every response as
 * `Server-Timing: isolate;desc="n=<requests so far> age=<ms since the isolate started>"`, so a
 * probe (`scripts/perf-probe.mjs`) can tell a cold start from a slow Worker. Numbers only.
 *
 * Module state on purpose: one counter per bundle per isolate (the proxy's bundle and the
 * server's each keep their own, which is enough: `n=1` means "this bundle's first request").
 */
const startedAt = performance.now();
let served = 0;

export interface IsolateTick {
  /** Requests this bundle has served in this isolate, this one included. */
  n: number;
  /** Milliseconds since the bundle was evaluated. */
  age: number;
}

/** Counts this request and reports the isolate's state. */
export function isolateTick(): IsolateTick {
  served += 1;
  return { n: served, age: Math.round(performance.now() - startedAt) };
}

/** The isolate's state without counting a request (a diagnostic read). */
export function isolateState(): IsolateTick {
  return { n: served, age: Math.round(performance.now() - startedAt) };
}

/** The `Server-Timing` header value for a request: the named durations, then the isolate. */
export function serverTiming(
  durations: Record<string, number>,
  isolate: IsolateTick = isolateState(),
): string {
  const parts = Object.entries(durations).map(([name, ms]) => `${name};dur=${Math.round(ms)}`);
  parts.push(`isolate;desc="n=${isolate.n} age=${isolate.age}"`);
  return parts.join(", ");
}
