import { ShieldOffIcon } from "lucide-react";
import Link from "next/link";

import { ERROR_MESSAGES } from "@/core/errors";
import { Button } from "@/core/ui/primitives/button";

import { ErrorState } from "./error-state";

/**
 * Permission-denied state (403). Rendered by the `/forbidden` route and by pages whose
 * `requirePermission` check fails. Says nothing about what the record was.
 */
export function Forbidden({ homeHref = "/", message }: { homeHref?: string; message?: string }) {
  return (
    <ErrorState
      icon={ShieldOffIcon}
      tone="neutral"
      title="You can't open this"
      description={message ?? ERROR_MESSAGES.FORBIDDEN}
      action={
        <Button variant="outline" asChild>
          <Link href={homeHref}>Go home</Link>
        </Button>
      }
    />
  );
}
