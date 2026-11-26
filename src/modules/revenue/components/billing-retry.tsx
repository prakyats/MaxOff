"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/core/ui/primitives/button";

/**
 * "Try again" for the Billing section when its read failed (9.2 review): re-reads the screen in place (`router.refresh()`), so the rest of the page stays as it is and
 * no history entry is added. Neutral: nothing is committed.
 */
export function BillingRetry({ slot = "billing-retry" }: { slot?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      className="shrink-0"
      data-slot={slot}
      pending={pending}
      pendingLabel="Loading…"
      onClick={() => startTransition(() => router.refresh())}
    >
      Try again
    </Button>
  );
}
