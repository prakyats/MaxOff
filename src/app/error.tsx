"use client";

import Link from "next/link";
import { useEffect } from "react";

import { describeBoundaryError } from "@/core/errors/boundary";
import { captureException } from "@/core/observability/client";
import { ErrorState } from "@/core/ui/composites/error-state";
import { Button } from "@/core/ui/primitives/button";

/** Error boundary for routes outside the shell. `(app)/error.tsx` handles the signed-in area. */
export default function RootError({
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

  // The signed-in layout's own errors land here too (a boundary covers its children, not
  // itself): a transient session failure says "still signed in, try again" (2.6).
  const copy = describeBoundaryError(error);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center p-6">
      <ErrorState
        className="w-full"
        {...(copy.kind === "session-unavailable" ? { title: copy.title } : {})}
        description={copy.description}
        action={
          <>
            <Button variant="secondary" onClick={reset}>
              Try again
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/">Go home</Link>
            </Button>
          </>
        }
      />
    </main>
  );
}
