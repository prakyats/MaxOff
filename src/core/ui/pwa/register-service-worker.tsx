"use client";

import { useEffect } from "react";

import { shouldRegisterServiceWorker } from "./should-register";

/** Registers `public/sw.js` (the offline shell, ARCHITECTURE §14). Renders nothing. */
export function RegisterServiceWorker() {
  useEffect(() => {
    const ok = shouldRegisterServiceWorker({
      nodeEnv: process.env.NODE_ENV,
      hasServiceWorker: "serviceWorker" in navigator,
    });
    if (!ok) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.warn("Service worker registration failed", error);
    });
  }, []);
  return null;
}
