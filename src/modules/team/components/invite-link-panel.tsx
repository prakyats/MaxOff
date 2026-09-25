"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { Label } from "@/core/ui/primitives/label";

import { INVITE_LINK_HOURS } from "../domain/invite";

/**
 * The one-time invite link with a Copy button: what the email carries, for when there is no
 * sending domain yet or the email never arrived (WORKFLOWS §1a). Shown once; never stored.
 */
export function InviteLinkPanel({ link, note }: { link: string; note?: string | undefined }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy", { description: "Select the link and copy it by hand." });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="invite-link">Invite link</Label>
      <div className="flex gap-2">
        <Input
          id="invite-link"
          data-slot="invite-link"
          value={link}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button type="button" variant="secondary" onClick={copy} aria-label="Copy invite link">
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          Copy
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Works once and expires in {INVITE_LINK_HOURS} hours. Issuing a new link stops this one
        working.{note ? ` ${note}` : ""}
      </p>
    </div>
  );
}
