/** The longest a part waits for the browser to be idle (a busy page still gets its parts). */
export const IDLE_WAIT_MS = 2_000;
/** Where the browser cannot say when it is idle (Safari): a short wait instead. */
export const NO_IDLE_WAIT_MS = 200;

type Job = { run: () => unknown; wait: number; cancelled: boolean };

const queue: Job[] = [];
let busy = false;

function idle(run: () => void, wait: number): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: wait });
  } else {
    window.setTimeout(run, NO_IDLE_WAIT_MS);
  }
}

function pump(): void {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  idle(() => {
    let result: unknown;
    try {
      result = job.cancelled ? undefined : job.run();
    } catch {
      result = undefined;
    }
    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        busy = false;
        pump();
      });
  }, job.wait);
}

/**
 * Runs `run` in an idle moment of its own (phone-inp, option (b)). The parts a page loads after
 * itself (`AfterPage`, the live bell) go **one at a time**: each waits for its own idle callback,
 * and the next waits until the previous one's promise (its `import()`) has settled, so two chunks
 * that are heavy to evaluate (the Realtime client, 59–78 ms at CPU ×4; date-fns with the first
 * time-zone formatter, 72–97 ms) never land in the same busy stretch under a tap. `wait` caps how
 * long one job waits for idle once it is next. The returned function cancels a job not yet run.
 */
export function whenIdle(run: () => unknown, wait: number = IDLE_WAIT_MS): () => void {
  const job: Job = { run, wait, cancelled: false };
  queue.push(job);
  pump();
  return () => {
    job.cancelled = true;
    const at = queue.indexOf(job);
    if (at >= 0) queue.splice(at, 1);
  };
}
