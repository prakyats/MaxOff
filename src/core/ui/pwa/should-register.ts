/**
 * The service worker is registered only from a production build in a browser that supports
 * it. Under `next dev` a worker would cache stale chunks and fight hot reload, and Playwright
 * runs against `next dev` until task 1.2, so nothing there depends on it.
 */
export function shouldRegisterServiceWorker(input: {
  nodeEnv: string | undefined;
  hasServiceWorker: boolean;
}): boolean {
  return input.nodeEnv === "production" && input.hasServiceWorker;
}
