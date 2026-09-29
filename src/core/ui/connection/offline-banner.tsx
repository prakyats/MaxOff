"use client";

import { WifiOffIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { OFFLINE_BANNER_ID, OFFLINE_MESSAGE, useOnline } from "./online";

/**
 * "You're offline. Changes won't be saved until you're back online." (ARCHITECTURE §14.1, owner
 * 2026-09-28): a slim band above the bottom bar while the device is offline, gone when the
 * connection returns. Every commit button is disabled meanwhile and points here for its reason
 * (`Button`, `aria-describedby`). Not a layer and never a history entry; reading goes on as
 * normal. `html[data-offline]` gives it room: the sticky action bar, the FAB and the page's own
 * bottom padding sit above it (`--app-offline-h`, `globals.css`). The band wraps to two lines on
 * a phone, so its measured height replaces the CSS's 2rem once it is on screen (v1.0.0 review:
 * the second line covered the sticky bar's Save).
 */
export function OfflineBanner() {
  const online = useOnline();
  const band = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const html = document.documentElement;
    html.toggleAttribute("data-offline", !online);
    const element = band.current;
    if (online || !element) return;
    const measure = () => html.style.setProperty("--app-offline-h", `${element.offsetHeight}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      html.style.removeProperty("--app-offline-h");
    };
  }, [online]);
  // Nothing at all while online: a hidden live region would still answer to `[role="status"]`.
  if (online) return null;
  return (
    <p
      ref={band}
      id={OFFLINE_BANNER_ID}
      role="status"
      data-slot="offline-banner"
      className="bg-strong text-strong-foreground fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+var(--app-safe-bottom))] z-40 flex min-h-8 items-center justify-center gap-2 px-4 py-1.5 text-center text-sm"
    >
      <WifiOffIcon className="size-4 shrink-0" aria-hidden />
      {OFFLINE_MESSAGE}
    </p>
  );
}
