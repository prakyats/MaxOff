import { initClientSentry, onRouterTransitionStart } from "@/core/observability/client";

// Runs once in the browser before the app hydrates (ARCHITECTURE §18).
initClientSentry();

export { onRouterTransitionStart };
