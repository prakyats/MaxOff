"use client";

import { useState } from "react";

import { ApprovalGroup } from "@/core/ui/composites/approval-group";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { postKeepalive } from "@/core/ui/keepalive";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { approveItems, rejectItem } from "../actions/items";

/** The route behind the delayed send (`app/api/approvals/approve`): it outlives the page. */
const APPROVE_URL = "/api/approvals/approve";

/** A done item waiting for the viewer's approval, as the group shows it (worked out on the server). */
export type ItemApprovalRow = {
  id: string;
  title: string;
  /** "Brand film · Sharma Weddings · Done by Ravi, 8 Oct". */
  subtitle: string;
  project: string;
  client: string;
  cycle: string;
  doneBy: string;
  planned: string;
  notes: string | null;
  href: string;
};

/**
 * Approvals → **Client items** (7.4; PRODUCT §4.7 "Approvals", WORKFLOWS §5.3, kickoff 7 decision 16,
 * amendment C answers Q1): the done items of **the clients the viewer runs**, waiting for their
 * approval, oldest first, the last group. Approve is instant with the 6-second Undo (a delayed send);
 * "Approve all N" approves only the rows on screen, each its own approval; sending one back needs a
 * reason and lives behind Review (one item at a time, decision 16). The Owner's Approvals never show
 * this group (Q1): he approves from a project's page.
 */
export function ItemApprovalGroup({ items }: { items: readonly ItemApprovalRow[] }) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const review = items.find((item) => item.id === reviewId) ?? null;
  const rejecting = items.find((item) => item.id === rejectId) ?? null;

  return (
    <>
      <ApprovalGroup
        id="client-items"
        heading="Client items"
        noun={{ one: "item", other: "items" }}
        rows={items.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          status: "done",
          statusLabel: "Done",
          approvedLabel: `Approved ${item.title}`,
        }))}
        approve={(itemId) => postKeepalive<null>(APPROVE_URL, { kind: "item", id: itemId })}
        approveAll={(itemIds) => approveItems({ itemIds })}
        onReview={setReviewId}
      />
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? null : setReviewId(null))}
        title={review?.title ?? ""}
        description={review ? `${review.project} · ${review.client}` : undefined}
        actions={
          review ? (
            <>
              <Button variant="ghost" asChild>
                <OverlayLink href={review.href}>Open the project</OverlayLink>
              </Button>
              <Button variant="destructive" onClick={() => setRejectId(review.id)}>
                Send back…
              </Button>
            </>
          ) : null
        }
      >
        {review ? (
          <div className="flex flex-col gap-4" data-slot="item-review">
            <ReviewFacts
              facts={[
                { label: "Cycle", value: review.cycle },
                { label: "Done", value: review.doneBy },
                { label: "Planned", value: review.planned },
              ]}
            />
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-xs">Notes</p>
              <p className="break-words whitespace-pre-wrap">
                {review.notes ?? <span className="text-muted-foreground">No notes.</span>}
              </p>
            </div>
          </div>
        ) : null}
      </ReviewSheet>
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(open) => (open ? null : setRejectId(null))}
        title={rejecting ? `Send back ${rejecting.title}?` : "Send back"}
        description="It goes back to open to fix, with your reason."
        label="What needs to change"
        submitLabel="Send back"
        onSubmit={async (reason) => {
          if (!rejecting) return;
          const done = toastResult(await rejectItem({ itemId: rejecting.id, reason }), {
            success: "Sent back",
          });
          if (done) setReviewId(null);
          return done;
        }}
      />
    </>
  );
}
