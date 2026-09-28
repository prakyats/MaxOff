import { cn } from "@/core/lib/utils";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/ui/primitives/card";

import {
  balanceLine,
  type CompBalance,
  type CompCredit,
  CREDIT_STATUS_LABELS,
  describeCredit,
} from "../domain/credits";

import { GrantCompLeaveButton, RevokeCreditButton } from "./comp-leave-owner-actions";

/** The dot's colour for a credit's status, in the status vocabulary the app already colours. */
function dotFor(status: ReturnType<typeof describeCredit>["status"]): string {
  switch (status) {
    case "available":
      return "approved";
    case "reserved":
      return "pending_review";
    case "used":
      return "none";
    case "expired":
      return "none";
    case "revoked":
      return "cancelled";
  }
}

/**
 * Comp leave (PRODUCT §4.3a, 3b.2): the balance in one line ("1½ days of comp leave · use by
 * 30 Sep"), then each credit with its status. The member sees their own on the Extra work tab;
 * the Owner sees a person's on their Leave tab with **Grant comp leave** and **Revoke** on an
 * unused credit (`owner`).
 */
export function CompLeaveCard({
  balance,
  credits,
  today,
  owner,
}: {
  balance: CompBalance;
  credits: CompCredit[];
  today: string;
  /** Set for the Owner's view of a person: their id and name, for the actions' wording. */
  owner?: { memberId: string; name: string };
}) {
  return (
    <Card data-slot="comp-leave-card" className="mb-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Comp leave</CardTitle>
          <p data-slot="comp-balance" className="text-muted-foreground mt-1 text-sm">
            {balanceLine(balance)}
          </p>
        </div>
        {owner ? <GrantCompLeaveButton memberId={owner.memberId} name={owner.name} /> : null}
      </CardHeader>
      {credits.length > 0 ? (
        <CardContent className="px-0 pb-0">
          <ul className="divide-border divide-y border-t">
            {credits.map((credit) => {
              const row = describeCredit(credit, today);
              return (
                <li
                  key={credit.id}
                  data-slot="comp-credit"
                  data-status={row.status}
                  className={cn(
                    "flex flex-wrap items-center gap-3",
                    CARD_ROW_MIN_H,
                    CARD_ROW_PADDING,
                  )}
                >
                  <div className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
                    <span className="font-medium">{row.title}</span>
                    {row.detail || credit.note || credit.revokeReason ? (
                      <span className="text-muted-foreground text-sm break-words">
                        {[
                          row.detail,
                          credit.note
                            ? `${owner ? "Your" : "The Owner's"} note: ${credit.note}`
                            : "",
                          credit.revokeReason
                            ? `${owner ? "Your" : "The Owner's"} reason: ${credit.revokeReason}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </div>
                  <StatusDot
                    status={dotFor(row.status)}
                    label={CREDIT_STATUS_LABELS[row.status]}
                    className={cn(CARD_ROW_TRAILING, "text-sm")}
                  />
                  {owner && row.status === "available" && credit.reservedDays === 0 ? (
                    <RevokeCreditButton creditId={credit.id} name={owner.name} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}
