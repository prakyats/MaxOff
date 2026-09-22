import { CompassIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/core/ui/primitives/button";

import { ErrorState } from "./error-state";

/** Missing-page state (404). Used by `app/not-found.tsx` and by pages that call `notFound()`. */
export function NotFound({ homeHref = "/" }: { homeHref?: string }) {
  return (
    <ErrorState
      icon={CompassIcon}
      tone="neutral"
      title="Page not found"
      description="That page doesn't exist, or you can't see it."
      action={
        <Button variant="outline" asChild>
          <Link href={homeHref}>Go home</Link>
        </Button>
      }
    />
  );
}
