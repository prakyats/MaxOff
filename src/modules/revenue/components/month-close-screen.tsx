import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { captureException } from "@/core/observability/capture";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { StickyActions } from "@/core/ui/composites/sticky-actions";

import { monthName } from "../domain/billing";
import type { MonthCloseRead } from "../domain/month-close";
import { closeButtonLabel, monthCloseView, shortMonthName } from "../domain/month-close-view";

import { BillingRetry } from "./billing-retry";
import {
  CLOSE_CARD,
  CLOSE_HEADING,
  CLOSE_MONTH,
  CLOSE_NOTE,
  CLOSE_PAGE,
  CLOSE_ROW,
  CLOSE_ROW_END,
  CLOSE_ROW_TEXT,
  CLOSE_SECTION,
} from "./month-close-layout";
import { CloseMonthButton, CorrectMonthButton } from "./month-close-actions";
import { ChangeList } from "./month-close-changes";

const ROW_FOCUS =
  "active:bg-muted/60 focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset";

/**
 * The Owner's **close screen** (v3.5 U4; PRODUCT §4.13, WORKFLOWS §7): one IST month, from its
 * one read (`month_close_read`).
 * - **Open and ended:** what is still waiting, as counts that open the place each is settled
 *   (no amount), the expense-claims line until the 5th, and "Close September with 4 things still
 *   waiting" (nothing blocks the close), which asks once before it closes.
 * - **Cannot be closed** (not ended, or before the first priced month): the function's own reason
 *   and no button.
 * - **Closed:** "Closed 3 Oct · v1", every version (a correction with its note), "Changed since
 *   close" (revenue lines and totals, before → after in rupees, who changed a deliverable when the
 *   history says) and Correct, which shows the differences and asks for a note.
 *
 * **Owner only** (`finance.view`, checked by the route before the read starts; the read refuses
 * anyone else). A read that fails is this screen's own error with "Try again"; no amount is in a
 * message. A server component: Close and Correct load their layers on the first tap.
 */
export async function MonthCloseScreen({
  read,
  month,
}: {
  read: Promise<MonthCloseRead>;
  /** The month's first day, from the address (the heading of the error state). */
  month: string;
}) {
  let data: MonthCloseRead;
  try {
    data = await read;
  } catch (error) {
    captureException(error);
    return (
      <div className={CLOSE_PAGE} data-slot="month-close" data-state="error">
        <MonthLine name={monthName(month)} />
        <section className={CLOSE_SECTION} data-slot="month-close-section">
          <h3 className={CLOSE_HEADING}>Couldn&apos;t load</h3>
          <div className={CLOSE_CARD}>
            <div className={CLOSE_ROW} role="alert" data-slot="month-close-error">
              <div className={CLOSE_ROW_TEXT}>
                <p className="font-medium">This month couldn&apos;t load.</p>
                <p className="text-muted-foreground text-xs">Nothing was changed.</p>
              </div>
              <BillingRetry slot="month-close-retry" />
            </div>
          </div>
        </section>
      </div>
    );
  }

  const view = monthCloseView(data);
  const name = shortMonthName(data.month);

  if (view.state === "cannot") {
    return (
      <div className={CLOSE_PAGE} data-slot="month-close" data-state="cannot">
        <MonthLine name={data.monthName} />
        <section className={CLOSE_SECTION} data-slot="month-close-section">
          <h3 className={CLOSE_HEADING}>Not open to close</h3>
          <div className={CLOSE_CARD}>
            <div className={CLOSE_ROW} data-slot="month-close-reason">
              <div className={CLOSE_ROW_TEXT}>
                <p className="font-medium break-words">{view.message}</p>
                <p className="text-muted-foreground text-xs">
                  A month can be closed once it has ended, from the first month with an amount.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (view.state === "open") {
    return (
      <div className={CLOSE_PAGE} data-slot="month-close" data-state="open">
        <MonthLine name={data.monthName} />
        <section
          aria-labelledby="month-close-waiting"
          className={CLOSE_SECTION}
          data-slot="month-close-section"
        >
          <h3 id="month-close-waiting" className={CLOSE_HEADING}>
            Still waiting
          </h3>
          {view.waiting.length > 0 ? (
            <ul className={CLOSE_CARD} data-slot="month-close-waiting">
              {view.waiting.map((row) => (
                <li key={row.key}>
                  <DrillLink
                    href={row.href}
                    data-slot="month-close-waiting-row"
                    data-kind={row.key}
                    className={cn(CLOSE_ROW, ROW_FOCUS)}
                  >
                    <span className={CLOSE_ROW_TEXT}>
                      <span className="font-medium break-words">{row.label}</span>
                      <span className="text-muted-foreground text-xs break-words">
                        {row.meaning}
                      </span>
                    </span>
                    <span className={CLOSE_ROW_END}>
                      <span
                        className="font-medium tabular-nums"
                        data-slot="month-close-waiting-count"
                      >
                        {row.count}
                      </span>
                    </span>
                    <ChevronRightIcon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                  </DrillLink>
                </li>
              ))}
            </ul>
          ) : (
            <div className={CLOSE_CARD} data-slot="month-close-waiting">
              <div className={CLOSE_ROW} data-slot="month-close-nothing-waiting">
                <div className={CLOSE_ROW_TEXT}>
                  <p className="font-medium">Nothing is waiting.</p>
                  <p className="text-muted-foreground text-xs">
                    Every request, claim and deliverable of {name} is settled.
                  </p>
                </div>
              </div>
            </div>
          )}
          {view.waiting.length > 0 ? (
            <p className={CLOSE_NOTE} data-slot="month-close-not-blocking">
              None of this stops the close: it stays open and can be settled afterwards.
            </p>
          ) : null}
          {view.claims ? (
            <p className={CLOSE_NOTE} data-slot="month-close-claims">
              {view.claims}
            </p>
          ) : null}
        </section>
        <StickyActions>
          <CloseMonthButton
            month={data.month}
            monthName={name}
            label={view.button}
            waiting={view.total}
            confirmLabel={closeButtonLabel(data.month, 0)}
          />
        </StickyActions>
      </div>
    );
  }

  return (
    <div className={CLOSE_PAGE} data-slot="month-close" data-state="closed">
      <MonthLine name={data.monthName} />
      <section
        aria-labelledby="month-close-closed"
        className={CLOSE_SECTION}
        data-slot="month-close-section"
      >
        <h3 id="month-close-closed" className={CLOSE_HEADING} data-slot="month-close-closed">
          {view.closed}
        </h3>
        <ul className={CLOSE_CARD} data-slot="month-close-versions">
          {view.versions.map((version) => (
            <li key={version.id} className={CLOSE_ROW} data-slot="month-close-version">
              <span className={CLOSE_ROW_TEXT}>
                <span className="font-medium break-words">{version.title}</span>
                {version.note ? (
                  <span className="text-xs break-words" data-slot="month-close-version-note">
                    {version.note}
                  </span>
                ) : null}
                {version.by ? (
                  <span className="text-muted-foreground text-xs break-words">{version.by}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <p className={CLOSE_NOTE}>
          The saved report doesn&apos;t move. Correct rebuilds it from today&apos;s data as a new
          version and keeps the earlier ones.
        </p>
      </section>

      <section
        aria-labelledby="month-close-changed"
        className={CLOSE_SECTION}
        data-slot="month-close-changed"
      >
        <h3 id="month-close-changed" className={CLOSE_HEADING}>
          Changed since close
        </h3>
        <ChangeList changes={view.changes} totals={view.totals} />
      </section>

      <StickyActions>
        <CorrectMonthButton
          month={data.month}
          monthName={name}
          nextVersion={view.nextVersion}
          changes={view.changes}
          totals={view.totals}
        />
      </StickyActions>
    </div>
  );
}

function MonthLine({ name }: { name: string }) {
  return (
    <div className={CLOSE_MONTH} data-slot="month-close-month">
      <h2 className="text-base font-medium break-words">{name}</h2>
    </div>
  );
}
