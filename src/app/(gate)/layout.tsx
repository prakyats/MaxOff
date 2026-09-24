import type { CSSProperties, ReactNode } from "react";

import { LogoutButton, LogoutProvider } from "@/core/auth/components";
import { Toaster } from "@/core/ui/primitives/sonner";

/**
 * The day gate (ARCHITECTURE §8): no shell, because nothing else opens until the day has an
 * answer. It still offers Log out (someone who opened the app by mistake can leave), which
 * needs its own confirmation provider. There is no bottom bar here, so the sticky Submit bar
 * docks at the bottom edge (`--app-bottom-nav-h: 0`).
 */
export default function GateLayout({ children }: { children: ReactNode }) {
  return (
    <LogoutProvider>
      <div
        style={{ "--app-bottom-nav-h": "0rem" } as CSSProperties}
        className="bg-background text-foreground min-h-dvh"
      >
        <header className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-[max(1rem,env(safe-area-inset-left))] pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="bg-logo flex size-8 items-center justify-center rounded-md text-sm font-bold text-white"
            >
              M
            </span>
            <span className="text-base font-semibold tracking-tight">MaxOff</span>
          </div>
          <LogoutButton />
        </header>
        <main className="mx-auto w-full max-w-md px-[max(1rem,env(safe-area-inset-left))] pt-2 pb-[max(2.5rem,var(--app-safe-bottom))]">
          {children}
        </main>
      </div>
      <Toaster position="top-center" closeButton />
    </LogoutProvider>
  );
}
