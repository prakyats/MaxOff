import { LockIcon } from "lucide-react";
import Link from "next/link";

import { ERROR_MESSAGES } from "@/core/errors";
import { Button } from "@/core/ui/primitives/button";

import { ErrorState } from "./error-state";

/**
 * Permission-denied state (403). Rendered by the `/forbidden` route (under its standard header,
 * "No access", PP-crew-3) and by pages whose `requirePermission` check fails. Names what was
 * blocked in one line ("Clients are for the Owner and Admins", the approved pull-in sample,
 * V5b-D) and never what the record was; its one button goes to the reader's home ("Back to My
 * Day", FINAL 7).
 */
export function Forbidden({
  homeHref = "/",
  homeLabel = "Go home",
  title,
  message,
}: {
  homeHref?: string;
  homeLabel?: string;
  /** What was blocked and who it is for; without it, "You can't open this". */
  title?: string | null | undefined;
  message?: string;
}) {
  return (
    <ErrorState
      icon={LockIcon}
      tone="neutral"
      title={title ?? "You can't open this"}
      description={message ?? ERROR_MESSAGES.FORBIDDEN}
      action={
        // pending: none — a link home, it commits nothing (the screen's one solid button).
        <Button variant="primary" asChild>
          <Link href={homeHref} data-slot="forbidden-home">
            {homeLabel}
          </Link>
        </Button>
      }
    />
  );
}
