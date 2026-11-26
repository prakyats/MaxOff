import { ShieldCheckIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/core/ui/primitives/button-variants";
import { Card, CardContent } from "@/core/ui/primitives/card";

/**
 * The one-time card (v7.5 Q1): "Read how MaxOff uses your information", at the **end** of the home
 * screen (Today, My Day), so nothing above it moves when it appears, until the member taps "Got it"
 * on the notice (`privacy_notice_reads` holds this version). A navigation, not a commit, so its
 * link is the neutral outline (ADR-0015).
 */
export function PrivacyCard() {
  return (
    <Card data-slot="privacy-card" className="mt-6">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <ShieldCheckIcon className="text-muted-foreground size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Your information in MaxOff</p>
          <p className="text-muted-foreground text-sm">
            Read what MaxOff keeps about you, who can see it, and for how long.
          </p>
        </div>
        <Link href="/me/privacy" className={buttonVariants({ variant: "secondary" })}>
          Read it
        </Link>
      </CardContent>
    </Card>
  );
}
