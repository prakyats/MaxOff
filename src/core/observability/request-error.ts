import { captureException, withScope } from "@sentry/core";
import type { Instrumentation } from "next";

import { flushInBackground } from "./flush";

/**
 * Next's `onRequestError` (`src/instrumentation.ts`): every uncaught server rendering, route
 * handler, server action and proxy error. The same report `@sentry/nextjs`'s
 * `captureRequestError` made (ADR-0014): the `nextjs` context, the route as the transaction
 * name, an unhandled mechanism, and a flush through `waitUntil`. The request headers are not
 * passed on at all (the scrubber dropped them anyway); `request_path` is reduced to its path by
 * the scrubber, as before.
 */
export const captureRequestError: Instrumentation.onRequestError = (error, request, context) => {
  withScope((scope) => {
    scope.setSDKProcessingMetadata({ normalizedRequest: { method: request.method } });
    scope.setContext("nextjs", {
      request_path: request.path,
      router_kind: context.routerKind,
      router_path: context.routePath,
      route_type: context.routeType,
    });
    scope.setTransactionName(`${request.method} ${context.routePath}`);
    captureException(error, {
      mechanism: { handled: false, type: "auto.function.nextjs.on_request_error" },
    });
  });
  flushInBackground();
};
