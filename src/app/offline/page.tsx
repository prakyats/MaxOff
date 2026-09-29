import { Loader2Icon, WifiOffIcon } from "lucide-react";
import type { Metadata } from "next";

import { ErrorState } from "@/core/ui/composites/error-state";
import { buttonVariants } from "@/core/ui/primitives/button-variants";
import {
  OFFLINE_BACK_SLOT,
  OFFLINE_RETRY_SCRIPT,
  OFFLINE_RETRY_SLOT,
} from "@/core/ui/pwa/offline-retry";

export const metadata: Metadata = { title: "Offline" };

/**
 * Shown by the service worker when a navigation fails without a connection (ARCHITECTURE §14),
 * at the address that failed. Outside the app shell on purpose: it must render without a
 * session or any data. "Try again" and the reload once back online are a plain inline script
 * (`core/ui/pwa/offline-retry.ts`: the page may never hydrate), so the button is plain markup
 * with the shared pending look: the working label shares the label's grid cell, and
 * `data-pending` swaps them.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center p-6">
      <ErrorState
        tone="neutral"
        icon={WifiOffIcon}
        title="You’re offline"
        description="MaxOff needs a connection. Nothing is lost: everything you submitted is already on the server. Reconnect and try again."
        action={
          <>
            <button
              type="button"
              data-slot={OFFLINE_RETRY_SLOT}
              className={buttonVariants({ variant: "secondary", className: "group" })}
            >
              <span className="grid items-center justify-items-center *:[grid-area:1/1]">
                <span className="inline-flex items-center gap-1.5 group-data-[pending]:invisible">
                  Try again
                </span>
                <span className="invisible inline-flex items-center gap-1.5 group-data-[pending]:visible">
                  <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden />
                  Trying…
                </span>
              </span>
            </button>
            <p
              role="status"
              data-slot={OFFLINE_BACK_SLOT}
              hidden
              className="text-muted-foreground basis-full text-sm"
            >
              Back online, reloading…
            </p>
            <script dangerouslySetInnerHTML={{ __html: OFFLINE_RETRY_SCRIPT }} />
          </>
        }
        className="w-full"
      />
    </main>
  );
}
