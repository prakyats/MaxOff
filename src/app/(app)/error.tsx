"use client";

import Link from "next/link";
import { useEffect } from "react";

import { captureException } from "@/core/observability/client";
import { ErrorState } from "@/core/ui/composites/error-state";
import { Button } from "@/core/ui/primitives/button";

/** Error boundary inside the shell: the sidebar and top bar stay, only the page is replaced. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Next does not forward errors caught by an explicit boundary to Sentry's global handlers,
    // so the boundary reports them itself (ARCHITECTURE §18.2).
    captureException(error);
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="This page couldn't load"
      description={
        error.digest
          ? `Reference ${error.digest}. Try again, and mention this code if it keeps happening.`
          : "Try again in a moment."
      }
      action={
        <>
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" asChild>
            <Link href="/">Go home</Link>
          </Button>
        </>
      }
    />
  );
}
