import { WifiOffIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ErrorState } from "@/core/ui/composites/error-state";
import { buttonVariants } from "@/core/ui/primitives/button";

export const metadata: Metadata = { title: "Offline" };

/**
 * Shown by the service worker when a navigation fails without a connection (ARCHITECTURE §14).
 * Outside the app shell on purpose: it must render without a session or any data.
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
          <Link href="/" prefetch={false} className={buttonVariants({ variant: "secondary" })}>
            Try again
          </Link>
        }
        className="w-full"
      />
    </main>
  );
}
