import { ShieldOffIcon } from "lucide-react";
import Link from "next/link";

import { ERROR_MESSAGES } from "@/core/errors";
import { Button } from "@/core/ui/primitives/button";

import { ErrorState } from "./error-state";

/**
 * Permission-denied state (403). Rendered by the `/forbidden` route (under its standard header,
 * "No access", PP-crew-3) and by pages whose `requirePermission` check fails. Says nothing about
 * what the record was; its one button goes to the reader's home ("Back to My Day", FINAL 7).
 */
export function Forbidden({
  homeHref = "/",
  homeLabel = "Go home",
  message,
}: {
  homeHref?: string;
  homeLabel?: string;
  message?: string;
}) {
  return (
    <ErrorState
      icon={ShieldOffIcon}
      tone="neutral"
      title="You can't open this"
      description={message ?? ERROR_MESSAGES.FORBIDDEN}
      action={
        <Button variant="secondary" asChild>
          <Link href={homeHref} data-slot="forbidden-home">
            {homeLabel}
          </Link>
        </Button>
      }
    />
  );
}
