import { ChevronRightIcon } from "lucide-react";

import { formatRupees } from "@/core/lib/rupees";
import { cn } from "@/core/lib/utils";
import { captureException } from "@/core/observability/capture";

import {
  type Adjustment,
  type Advance,
  addedHeading,
  adjustmentLines,
  advanceSummary,
  amountLabel,
  amountSheetNote,
  amountText,
  BILLING_CATEGORY_LABELS,
  billingLineClosed,
  type BillingMark,
  billedText,
  canAdjust,
  cycleAmountLabel,
  cycleAmountNote,
  longDay,
  type OneTimeBilling,
  periodWord,
  type PlannedDeliverable,
  plannedHeading,
  plannedValueNote,
  plannedValueText,
  priceText,
  type ProjectBilling,
  type RetainerBilling,
  shortDay,
} from "../domain/billing";

import {
  BILLING_CARD,
  BILLING_CHEVRON,
  BILLING_DISCLOSURE,
  BILLING_FIGURE,
  BILLING_FIGURES,
  BILLING_FIGURES_GRID,
  BILLING_ROW,
  BILLING_ROW_TEXT,
  BILLING_SECTION,
  BILLING_SUMMARY,
} from "./billing-layout";
import { BillingHistory } from "./billing-history";
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
  closedMonths = null,
}: {
  read: Promise<ProjectBilling>;
  /** Today in IST (`todayIST()`), for the sheets' dates and the first amount's month. */
  today: string;
  /**
   * The closed months' first days (`readClosedMonths`, v3.5 U5), for the sheets' "September is
   * closed. Its report changes only when you correct it." line. Null: no line.
   */
  closedMonths?: Promise<readonly string[]> | null;
}) {
  let billing: ProjectBilling;
  try {
    billing = await read;
  } catch (error) {
    captureException(error);
    return <BillingError />;
  }
  const closed = await closedMonthsOf(closedMonths);
  const { category, pricedFrom } = billing.billing;
  const current =
    billing.kind === "one_time" ? billing.billing.fixedAmount : billing.billing.cycleAmount;
  const label = amountLabel(billing.recurrence);
  // The month the project's own line counts in: its amount (one-time), Adjust and planned values.
  const lineClosed = billingLineClosed(billing, closed);
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
              // A retainer's amount applies from this cycle on (never a closed month); a one-time
              // project's lands in its own month.
              closed: billing.kind === "one_time" ? lineClosed : null,
            }}
          />
        </div>
        {billing.kind === "retainer" ? (
          <RetainerRows billing={billing} today={today} closedLine={lineClosed} />
        ) : (
          <OneTimeRows billing={billing} today={today} closed={closed} closedLine={lineClosed} />
        )}
      </div>
    </section>
  );
}

/**
 * The closed months, or none when the read failed (the line is a reminder, never a gate: the
 * section and its sheets work without it). Reported once through the scrubber.
 */
async function closedMonthsOf(read: Promise<readonly string[]> | null): Promise<readonly string[]> {
  if (!read) return [];
  try {
    return await read;
  } catch (error) {
    captureException(error);
    return [];
  }
}

/**
 * v2.5: **Billed / Not billed**, one 64 px row (its label over one line: "Not billed", or "Billed
 * on 3 Dec · ‹note›", cut to the line), with "Mark billed" or "Mark not billed" beside it.
 */
function BilledRow({
  cycleId,
  mark,
  what,
  today,
}: {
  cycleId: string;
  mark: BillingMark;
  /** "November 2026", "this week", "this project": what the sheet marks. */
  what: string;
  today: string;
}) {
  const words = billedText(mark);
  return (
    <div className={BILLING_ROW} data-slot="billing-billed" data-billed={mark.billed}>
      <div className={BILLING_ROW_TEXT}>
        <p className="text-muted-foreground text-xs">Billing</p>
        <p data-slot="billing-value" className="truncate" title={words}>
          {words}
        </p>
      </div>
      {mark.billed ? (
        <BillingSheetButton
          label="Mark not billed"
          slot="billing-not-billed"
          sheet={{ kind: "markNotBilled", cycleId, what, billed: words }}
        />
      ) : (
        <BillingSheetButton
          label="Mark billed"
          slot="billing-mark-billed"
          sheet={{ kind: "markBilled", cycleId, what, today }}
        />
      )}
    </div>
  );
}

/**
 * v2.5: **Adjust** (decision 6), one row of three lines: "Achieved" or "Owner adjusted · ‹note›",
 * the headline figure, and "As calculated from approved work" or "System calculated ₹Y". Its
 * control: "Adjust", or "Back to calculated" once adjusted.
 */
function AdjustRow({
  scope,
  refId,
  figures,
  closed,
}: {
  scope: "cycle" | "project";
  refId: string;
  figures: { achieved: number; achievedCalculated: number; adjustment: Adjustment | null };
  /** "September is closed. …" when the line's month is closed (decision 10), else null. */
  closed: string | null;
}) {
  const lines = adjustmentLines(figures);
  const calculated = formatRupees(figures.achievedCalculated);
  return (
    <div
      className={BILLING_ROW}
      data-slot="billing-adjust"
      data-adjusted={figures.adjustment !== null}
    >
      <div className={BILLING_ROW_TEXT}>
        <p className="text-muted-foreground truncate text-xs" title={lines.label}>
          {lines.label}
        </p>
        <p data-slot="billing-value" className="truncate font-medium tabular-nums">
          {lines.value}
        </p>
        <p
          data-slot="billing-adjust-detail"
          className="text-muted-foreground truncate text-xs tabular-nums"
        >
          {lines.detail}
        </p>
      </div>
      {figures.adjustment ? (
        <BillingSheetButton
          label="Back to calculated"
          slot="billing-adjust-clear"
          sheet={{
            kind: "clearAdjust",
            scope,
            refId,
            adjusted: formatRupees(figures.adjustment.adjustedValue),
            calculated,
          }}
        />
      ) : (
        <BillingSheetButton
          label="Adjust"
          name="Adjust achieved"
          slot="billing-adjust-set"
          sheet={{ kind: "adjust", scope, refId, calculated, closed }}
        />
      )}
    </div>
  );
}

/**
 * v2.5: the cycle's **planned deliverables' values**, collapsed to one row ("Planned deliverables
 * · 4"); opened, each with its value and how it is valued (its own, or a share), and "Set value"
 * or "Change" and "Back to share". A function's refusal (over the amount, no amount yet) is said
 * in the sheet, plainly.
 */
function PlannedList({
  planned,
  amount,
  recurrence,
  closed,
}: {
  planned: PlannedDeliverable[];
  amount: number | null;
  recurrence: "weekly" | "monthly";
  /** "September is closed. …" when the cycle's month is closed (decision 10), else null. */
  closed: string | null;
}) {
  return (
    <details className={BILLING_DISCLOSURE} data-slot="billing-planned">
      <summary className={BILLING_SUMMARY} data-slot="billing-planned-toggle">
        <span className={BILLING_ROW_TEXT}>
          <span className="font-medium">{plannedHeading(planned.length)}</span>
          <span className="text-muted-foreground truncate text-xs">
            Each one&apos;s value: its own, or a share of the amount
          </span>
        </span>
        <ChevronRightIcon aria-hidden className={BILLING_CHEVRON} />
      </summary>
      {planned.length === 0 ? (
        <p className="text-muted-foreground border-border border-t px-4 py-3">
          No planned deliverables in this {periodWord(recurrence)}.
        </p>
      ) : (
        <ul className="divide-border border-border divide-y border-t">
          {planned.map((item) => (
            <li
              key={item.itemId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2"
              data-slot="billing-planned-row"
              data-method={item.method}
            >
              <div className="flex min-h-11 min-w-0 flex-[1_1_10rem] flex-col justify-center gap-0.5">
                <p className="break-words">{item.title}</p>
                <p
                  data-slot="billing-planned-value"
                  className="text-muted-foreground text-xs tabular-nums"
                >
                  {plannedValueText(item)}
                </p>
              </div>
              {item.method === "excluded" ? null : (
                <div className="ml-auto flex shrink-0 gap-2">
                  {item.method === "explicit" ? (
                    <BillingSheetButton
                      label="Back to share"
                      name={`Back to share: ${item.title}`}
                      slot="billing-planned-share"
                      sheet={{
                        kind: "share",
                        itemId: item.itemId,
                        title: item.title,
                        value: formatRupees(item.value),
                      }}
                    />
                  ) : null}
                  <BillingSheetButton
                    label={item.method === "explicit" ? "Change" : "Set value"}
                    name={`${item.method === "explicit" ? "Change the value of" : "Set value of"} ${item.title}`}
                    slot="billing-planned-set"
                    sheet={{
                      kind: "plannedValue",
                      itemId: item.itemId,
                      title: item.title,
                      current: item.method === "explicit" ? item.value : null,
                      note: plannedValueNote(item.title, amount, recurrence),
                      closed,
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** What the section shows, as one string: an open Billing history reads again when it moves. */
function revisionOf(billing: ProjectBilling): string {
  return JSON.stringify(billing);
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

/**
 * The cycle in view: its figures, then (v2.5) Billed, Adjust, the planned deliverables' values
 * and Billing history, each a fixed row the skeleton draws too; then what varies with the data
 * (an earlier cycle's own amount, the deliverables added on top), which only grows downward.
 * Without a cycle in view, Billing history alone.
 */
function RetainerRows({
  billing,
  today,
  closedLine,
}: {
  billing: RetainerBilling;
  today: string;
  /** "September is closed. …" when the cycle's month is closed (v3.5 U5), else null. */
  closedLine: string | null;
}) {
  const { cycle, added, recurrence } = billing;
  const history = (
    <BillingHistory projectId={billing.projectId} oneTime={false} revision={revisionOf(billing)} />
  );
  if (!cycle) return history;
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
      <BilledRow
        cycleId={cycle.cycleId}
        mark={cycle.mark}
        what={cycle.label ?? `this ${period}`}
        today={today}
      />
      {canAdjust(billing) ? (
        <AdjustRow scope="cycle" refId={cycle.cycleId} figures={cycle} closed={closedLine} />
      ) : null}
      <PlannedList
        planned={billing.planned}
        amount={cycle.amount}
        recurrence={recurrence}
        closed={closedLine}
      />
      {history}
      {/* Q1: a cycle from before the first amount is priced alone, here; the project's amount
          never reaches it. Its own row under the figures, so nothing above moves. Only once the
          project has an amount: before that, "Set amount" above is the one control. */}
      {cycle.amount === null && billing.billing.cycleAmount !== null ? (
        <div className={BILLING_ROW} data-slot="billing-cycle-amount">
          <div className={BILLING_ROW_TEXT}>
            <p className="break-words">{cycle.label ?? `This ${period}`}</p>
            <p className="text-muted-foreground text-xs">No amount set</p>
          </div>
          <BillingSheetButton
            label={cycleAmountLabel(recurrence)}
            slot="billing-cycle-amount-set"
            sheet={{
              kind: "cycleAmount",
              cycleId: cycle.cycleId,
              title: cycleAmountLabel(recurrence),
              note: cycleAmountNote(cycle.label, recurrence),
              closed: closedLine,
            }}
          />
        </div>
      ) : null}
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
                  // The name starts with the words on the button (WCAG 2.5.3, speech control).
                  name={`${item.price === null ? "Set price of" : "Change the price of"} ${item.title}`}
                  slot="billing-price-set"
                  sheet={{
                    kind: "price",
                    itemId: item.itemId,
                    title: item.title,
                    current: item.price,
                    period,
                    closed: closedLine,
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
function OneTimeRows({
  billing,
  today,
  closed,
  closedLine,
}: {
  billing: OneTimeBilling;
  today: string;
  /** The closed months' first days, for the advances' sheets (the date picked decides). */
  closed: readonly string[];
  /** "September is closed. …" when the project's month is closed (v3.5 U5), else null. */
  closedLine: string | null;
}) {
  const { fixedAmount } = billing.billing;
  const status = [
    billing.wasDue ? `Was due ${shortDay(billing.wasDue)}` : null,
    billing.readyToComplete ? "Ready to complete" : null,
  ].filter(Boolean);
  const summary = advanceSummary(fixedAmount, billing.advancesKept);
  const canRecord = fixedAmount !== null && fixedAmount > billing.advancesKept;
  const { line } = billing;
  return (
    <>
      {status.length > 0 ? (
        <p className="px-4 py-3 font-medium" data-slot="billing-status">
          {status.join(" · ")}
        </p>
      ) : null}
      {/* v2.5: Billed (through the project's one cycle), Adjust once completed, the history. */}
      {line?.cycleId ? (
        <BilledRow cycleId={line.cycleId} mark={line.mark} what="this project" today={today} />
      ) : null}
      {line && canAdjust(billing) ? (
        <AdjustRow scope="project" refId={billing.projectId} figures={line} closed={closedLine} />
      ) : null}
      <BillingHistory projectId={billing.projectId} oneTime revision={revisionOf(billing)} />
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
              sheet={{ kind: "advance", projectId: billing.projectId, today, closedMonths: closed }}
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
              <AdvanceRow key={advance.id} advance={advance} today={today} closed={closed} />
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

function AdvanceRow({
  advance,
  today,
  closed,
}: {
  advance: Advance;
  today: string;
  closed: readonly string[];
}) {
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
          name={`Mark returned: the advance of ${formatRupees(advance.amount)}`}
          slot="billing-advance-return"
          sheet={{
            kind: "return",
            advanceId: advance.id,
            summary: received,
            receivedOn: advance.receivedOn,
            today,
            closedMonths: closed,
          }}
        />
      )}
    </li>
  );
}
