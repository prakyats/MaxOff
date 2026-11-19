import { formatRupees } from "@/core/lib/rupees";
import { cn } from "@/core/lib/utils";
import { captureException } from "@/core/observability/capture";

import {
  type Advance,
  addedHeading,
  advanceSummary,
  amountLabel,
  amountSheetNote,
  amountText,
  BILLING_CATEGORY_LABELS,
  longDay,
  type OneTimeBilling,
  periodWord,
  priceText,
  type ProjectBilling,
  type RetainerBilling,
  shortDay,
} from "../domain/billing";

import {
  BILLING_CARD,
  BILLING_FIGURE,
  BILLING_FIGURES,
  BILLING_FIGURES_GRID,
  BILLING_ROW,
  BILLING_ROW_TEXT,
  BILLING_SECTION,
} from "./billing-layout";
import { BillingRetry } from "./billing-retry";
import { BillingSheetButton } from "./billing-sheet-button";

/**
 * A project's **Billing** section (9.2, v2.1 "Money in"; PRODUCT §4.9, WORKFLOWS §6, DATA-MODEL
 * §7): **the Owner's alone**. The project page renders it, and starts its read, only for a viewer
 * with `finance.view`; an Admin's page has neither the section nor its request (invariant 2).
 *
 * A retainer: its category, its amount per month or week, the cycle in view (Potential ·
 * Achieved · Remaining) and the deliverables added on top of that cycle, each with its price or
 * "Not priced". A one-time project: its category, its one amount, "Was due" / "Ready to complete"
 * when true, and its advances. Every control opens a sheet where the change is committed; the
 * functions behind them decide again. A server component: the sheets load on the first tap.
 *
 * **A read that fails stays inside the section** (9.2 review): the project page (its
 * deliverables, Details, every control) is the Owner's working screen and never falls to the
 * error page because the money read did. The section then says so in its own card, with a
 * "Try again" that re-reads the page in place. The failure is reported once (through the
 * scrubber, ARCHITECTURE §18.2; a refusal's text and the parser's messages carry no amount).
 */
export async function BillingSection({
  read,
  today,
}: {
  read: Promise<ProjectBilling>;
  /** Today in IST (`todayIST()`), for the sheets' dates and the first amount's month. */
  today: string;
}) {
  let billing: ProjectBilling;
  try {
    billing = await read;
  } catch (error) {
    captureException(error);
    return <BillingError />;
  }
  const { category, pricedFrom } = billing.billing;
  const current =
    billing.kind === "one_time" ? billing.billing.fixedAmount : billing.billing.cycleAmount;
  const label = amountLabel(billing.recurrence);
  return (
    <section
      aria-labelledby="project-billing"
      className={BILLING_SECTION}
      data-slot="project-billing"
    >
      <h2 id="project-billing" className="text-sm font-medium">
        Billing
      </h2>
      <div className={BILLING_CARD}>
        <div className={BILLING_ROW} data-slot="billing-category">
          <div className={BILLING_ROW_TEXT}>
            <p className="text-muted-foreground text-xs">Category</p>
            <p data-slot="billing-value">{BILLING_CATEGORY_LABELS[category]}</p>
          </div>
          <BillingSheetButton
            label="Change"
            name="Change the category"
            slot="billing-category-change"
            sheet={{ kind: "category", projectId: billing.projectId, current: category }}
          />
        </div>
        <div className={BILLING_ROW} data-slot="billing-amount">
          <div className={BILLING_ROW_TEXT}>
            <p className="text-muted-foreground text-xs">{label}</p>
            <p
              data-slot="billing-value"
              className={cn("tabular-nums", current === null && "text-muted-foreground")}
            >
              {amountText(current)}
            </p>
          </div>
          <BillingSheetButton
            label={current === null ? "Set amount" : "Change"}
            name={current === null ? undefined : "Change the amount"}
            slot="billing-amount-set"
            sheet={{
              kind: "amount",
              projectId: billing.projectId,
              label,
              current,
              note: amountSheetNote(billing.recurrence, pricedFrom, today),
            }}
          />
        </div>
        {billing.kind === "retainer" ? (
          <RetainerRows billing={billing} />
        ) : (
          <OneTimeRows billing={billing} today={today} />
        )}
      </div>
    </section>
  );
}

/** The section when its read failed: the heading stays, the card says so and offers a retry. */
function BillingError() {
  return (
    <section
      aria-labelledby="project-billing"
      className={BILLING_SECTION}
      data-slot="project-billing"
      data-state="error"
    >
      <h2 id="project-billing" className="text-sm font-medium">
        Billing
      </h2>
      <div className={BILLING_CARD}>
        <div className={BILLING_ROW} role="alert" data-slot="billing-error">
          <div className={BILLING_ROW_TEXT}>
            <p className="font-medium">Billing couldn&apos;t load.</p>
            <p className="text-muted-foreground text-xs">
              The rest of the project is fine. Nothing was changed.
            </p>
          </div>
          <BillingRetry />
        </div>
      </div>
    </section>
  );
}

function Figure({ label, value, slot }: { label: string; value: number; slot: string }) {
  return (
    <div className={BILLING_FIGURE} data-slot={slot}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium break-words tabular-nums">{formatRupees(value)}</dd>
    </div>
  );
}

/** The cycle in view and what was added on top of it. */
function RetainerRows({ billing }: { billing: RetainerBilling }) {
  const { cycle, added, recurrence } = billing;
  if (!cycle) return null;
  const period = periodWord(recurrence);
  return (
    <>
      <div className={BILLING_FIGURES} data-slot="billing-cycle">
        <p className="text-muted-foreground text-xs break-words">
          {cycle.label ?? `This ${period}`}
          {cycle.amount === null && billing.billing.cycleAmount !== null
            ? " · No amount set"
            : null}
        </p>
        <dl className={BILLING_FIGURES_GRID}>
          <Figure label="Potential" value={cycle.potential} slot="billing-potential" />
          <Figure label="Achieved" value={cycle.achieved} slot="billing-achieved" />
          <Figure label="Remaining" value={cycle.remaining} slot="billing-remaining" />
        </dl>
      </div>
      {added.length > 0 ? (
        <div data-slot="billing-added">
          <h3 className="text-muted-foreground px-4 pt-3 text-xs">{addedHeading(recurrence)}</h3>
          <ul className="divide-border divide-y">
            {added.map((item) => (
              <li key={item.itemId} className={BILLING_ROW} data-slot="billing-added-row">
                <div className={BILLING_ROW_TEXT}>
                  <p className="break-words">{item.title}</p>
                  <p
                    data-slot="billing-price"
                    className={cn(
                      "tabular-nums",
                      item.price === null ? "font-medium" : "text-muted-foreground",
                    )}
                  >
                    {priceText(item.price)}
                  </p>
                </div>
                <BillingSheetButton
                  label={item.price === null ? "Set price" : "Change"}
                  name={`${item.price === null ? "Set the price of" : "Change the price of"} ${item.title}`}
                  slot="billing-price-set"
                  sheet={{
                    kind: "price",
                    itemId: item.itemId,
                    title: item.title,
                    current: item.price,
                    period,
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/** "Was due" / "Ready to complete" when true, then the advances. */
function OneTimeRows({ billing, today }: { billing: OneTimeBilling; today: string }) {
  const { fixedAmount } = billing.billing;
  const status = [
    billing.wasDue ? `Was due ${shortDay(billing.wasDue)}` : null,
    billing.readyToComplete ? "Ready to complete" : null,
  ].filter(Boolean);
  const summary = advanceSummary(fixedAmount, billing.advancesKept);
  const canRecord = fixedAmount !== null && fixedAmount > billing.advancesKept;
  return (
    <>
      {status.length > 0 ? (
        <p className="px-4 py-3 font-medium" data-slot="billing-status">
          {status.join(" · ")}
        </p>
      ) : null}
      <div data-slot="billing-advances">
        <div className={BILLING_ROW}>
          <div className={BILLING_ROW_TEXT}>
            <h3 className="font-medium">Advances</h3>
            {fixedAmount === null ? (
              <p className="text-muted-foreground text-xs">Set the amount to record an advance.</p>
            ) : billing.advances.length === 0 ? (
              <p className="text-muted-foreground text-xs">None received yet.</p>
            ) : null}
          </div>
          {canRecord ? (
            <BillingSheetButton
              label="Record advance"
              slot="billing-advance-record"
              sheet={{ kind: "advance", projectId: billing.projectId, today }}
            />
          ) : null}
        </div>
        {summary ? (
          <p className="px-4 pb-3 break-words tabular-nums" data-slot="billing-advance-summary">
            {summary}
          </p>
        ) : null}
        {billing.advances.length > 0 ? (
          <ul className="divide-border border-border divide-y border-t">
            {billing.advances.map((advance) => (
              <AdvanceRow key={advance.id} advance={advance} today={today} />
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

function AdvanceRow({ advance, today }: { advance: Advance; today: string }) {
  const received = `${formatRupees(advance.amount)} received on ${longDay(advance.receivedOn)}`;
  return (
    <li className={BILLING_ROW} data-slot="billing-advance-row">
      <div className={BILLING_ROW_TEXT}>
        <p className="tabular-nums">
          <span className="font-medium">{formatRupees(advance.amount)}</span>
          <span className="text-muted-foreground"> · {longDay(advance.receivedOn)}</span>
        </p>
        {advance.note ? (
          <p className="text-muted-foreground text-xs break-words">{advance.note}</p>
        ) : null}
        {advance.returnedOn ? (
          <p className="text-xs break-words" data-slot="billing-advance-returned">
            Returned on {shortDay(advance.returnedOn)}
            {advance.returnNote ? ` · ${advance.returnNote}` : ""}
          </p>
        ) : null}
      </div>
      {advance.returnedOn ? null : (
        <BillingSheetButton
          label="Mark returned"
          name={`Mark the advance of ${formatRupees(advance.amount)} returned`}
          slot="billing-advance-return"
          sheet={{
            kind: "return",
            advanceId: advance.id,
            summary: received,
            receivedOn: advance.receivedOn,
            today,
          }}
        />
      )}
    </li>
  );
}
