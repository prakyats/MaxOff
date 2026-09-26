import type { ReactNode } from "react";

/**
 * The signed-out screens (sign in, forgot password) and set password: one centred card, no
 * shell, laid out for a phone first. The proxy sends a signed-in member away from the
 * sign-in pages; set password needs the session a recovery link opened.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // Safe-area padding: with `viewport-fit=cover` a centred card can otherwise sit under the
    // notch in landscape, and the card's bottom edge under the home indicator on a short screen
    // (ARCHITECTURE §14.1).
    <main className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center px-[max(1rem,env(safe-area-inset-left))] py-10 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,var(--app-safe-bottom))]">
      <div className="mb-6 flex items-center gap-2">
        <span
          aria-hidden
          className="bg-logo flex size-8 items-center justify-center rounded-md text-sm font-bold text-white"
        >
          M
        </span>
        <span className="text-base font-semibold tracking-tight">MaxOff</span>
      </div>
      <div className="bg-card text-card-foreground w-full max-w-sm rounded-xl border p-6 shadow-sm">
        {children}
      </div>
    </main>
  );
}
