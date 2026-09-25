"use client";

import Link from "next/link";
import { useEffect } from "react";

import { describeBoundaryError } from "@/core/errors/boundary";
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

  // A transient session failure says "still signed in, try again" (2.6); the rest is generic.
  const copy = describeBoundaryError(error);
  return (
    <ErrorState
      title={copy.title}
      description={copy.description}
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
