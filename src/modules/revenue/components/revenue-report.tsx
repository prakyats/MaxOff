import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { formatRupees } from "@/core/lib/rupees";
import { cn } from "@/core/lib/utils";
import { captureException } from "@/core/observability/capture";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { OnHoldBadge } from "@/core/ui/composites/status-badge";
import { ViewLink } from "@/core/ui/composites/view-link";
import { Button } from "@/core/ui/primitives/button";

import {
  CATEGORY_FILTER_LABELS,
  CATEGORY_FILTERS,
  type CategoryFilter,
  type ClientGroup,
  lineBilling,
  lineFigure,
  lineHref,
  lineKey,
  lineNotes,
  lineStatus,
  markAllLabel,
  monthSwitcher,
  onHoldText,
  type RevenueException,
  revenueHref,
  type RevenueLine,
  type RevenueMonth,
  revenueView,
  type Totals,
} from "../domain/revenue";

import { BillingRetry } from "./billing-retry";
import { BillingSheetButton } from "./billing-sheet-button";
import {
  REVENUE_CARD,
  REVENUE_CLIENT_HEAD,
  REVENUE_FIGURE,
  REVENUE_FIGURES,
  REVENUE_FILTER,
  REVENUE_FILTER_CELL,
  REVENUE_LINE,
  REVENUE_LINE_FIGURE,
  REVENUE_LINE_TEXT,
  REVENUE_PAGE,
  REVENUE_PAGER,
  REVENUE_SECTION,
} from "./revenue-layout";

const ROW_FOCUS =
  "active:bg-muted/60 focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset";

/**
 * The Owner's **Revenue** page (9.2, v2.1 "Money in"; PRODUCT §4.9, WORKFLOWS §6): one IST month.
 * First glance: Potential · Achieved · Remaining, with the advances received apart (never inside
 * Achieved) and what needs a look; then each client's lines, each of which opens its project at
 * the Billing section. The month and the category are view controls (`ViewLink`: they replace
 * the entry, so one back leaves the page, ARCHITECTURE §14.2 d).
 *
 * **Owner only**: the route checks `finance.view` before it starts the read, and the read
 * refuses anyone else. A read that fails is this page's own error state with a "Try again"
 * (reported once through the scrubber; no amount is in a message). A server component.
 */
export async function RevenueReport({
  read,
  category,
  today,
}: {
  read: Promise<RevenueMonth>;
  category: CategoryFilter;
  /** Today in IST (`todayIST()`): "Mark all N billed" marks them on this day by default. */
  today: string;
}) {
  let month: RevenueMonth;
  try {
    month = await read;
  } catch (error) {
    captureException(error);
    return (
      <div className={REVENUE_PAGE} data-slot="revenue" data-state="error">
        <div className={REVENUE_CARD}>
          <div className={REVENUE_LINE} role="alert" data-slot="revenue-error">
            <div className={REVENUE_LINE_TEXT}>
              <p className="font-medium">Revenue couldn&apos;t load.</p>
              <p className="text-muted-foreground text-xs">Nothing was changed.</p>
            </div>
            <BillingRetry slot="revenue-retry" />
          </div>
        </div>
      </div>
    );
  }
  const view = revenueView(month, category);
  const switcher = monthSwitcher(month);
  const href = (next: { month?: string; category?: CategoryFilter }) =>
    revenueHref(
      { month: next.month ?? month.month, category: next.category ?? category },
      month.thisMonth,
    );
  return (
    <div className={REVENUE_PAGE} data-slot="revenue">
      <div className={REVENUE_PAGER} role="group" aria-label="Month" data-slot="revenue-month">
        <PagerLink
          href={switcher.previous ? href({ month: switcher.previous }) : null}
          label="Previous month"
        >
          <ChevronLeftIcon aria-hidden />
        </PagerLink>
        <p
          className="min-w-0 text-center text-sm font-medium tabular-nums"
          aria-live="polite"
          data-slot="revenue-month-label"
        >
          {switcher.label}
        </p>
        <PagerLink href={switcher.next ? href({ month: switcher.next }) : null} label="Next month">
          <ChevronRightIcon aria-hidden />
        </PagerLink>
      </div>

      <nav aria-label="Category" className={REVENUE_FILTER} data-slot="revenue-filter">
        {CATEGORY_FILTERS.map((option) => (
          <ViewLink
            key={option}
            href={href({ category: option })}
            scroll={false}
            aria-current={option === category ? "page" : undefined}
            className={cn(
              REVENUE_FILTER_CELL,
              "focus-visible:ring-ring outline-none select-none focus-visible:ring-2",
              option === category
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground active:bg-background/60",
            )}
          >
            {CATEGORY_FILTER_LABELS[option]}
          </ViewLink>
        ))}
      </nav>

      <div className={REVENUE_CARD} data-slot="revenue-summary">
        <Figures totals={view.totals} />
        {/* v2.5: the month's lines not billed yet, marked billed together (a confirm sheet). */}
        {view.unbilled.length > 0 ? (
          <div className={REVENUE_LINE} data-slot="revenue-mark-all">
            <div className={REVENUE_LINE_TEXT}>
              <p className="text-muted-foreground text-xs">Billing</p>
              <p className="break-words">
                {view.unbilled.length === 1
                  ? "1 line not billed yet"
                  : `${view.unbilled.length} lines not billed yet`}
              </p>
            </div>
            <BillingSheetButton
              label={markAllLabel(view.unbilled.length)}
              slot="revenue-mark-all-billed"
              sheet={{
                kind: "markAll",
                cycleIds: view.unbilled,
                month: switcher.label,
                today,
              }}
            />
          </div>
        ) : null}
        {view.advances.received > 0 || view.advances.returned > 0 ? (
          <p className="px-4 py-3 break-words tabular-nums" data-slot="revenue-advances">
            Advances received{" "}
            <span className="font-medium">{formatRupees(view.advances.received)}</span>
            {view.advances.returned > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                · {formatRupees(view.advances.returned)} returned
              </span>
            ) : null}
          </p>
        ) : null}
        {view.totals.closedNotAchieved > 0 ? (
          <p
            className="text-muted-foreground px-4 py-3 break-words tabular-nums"
            data-slot="revenue-closed"
          >
            Closed, not achieved {formatRupees(view.totals.closedNotAchieved)}
          </p>
        ) : null}
      </div>

      {view.empty ? (
        <EmptyState title="No revenue this month." />
      ) : (
        <>
          {view.exceptions.length > 0 ? <NeedsALook exceptions={view.exceptions} /> : null}
          {view.clients.length > 0 ? (
            <section aria-labelledby="revenue-by-client" className={REVENUE_SECTION}>
              <h2 id="revenue-by-client" className="text-sm font-medium">
                By client
              </h2>
              <div className="flex flex-col gap-3">
                {view.clients.map((client) => (
                  <ClientCard key={client.clientId} client={client} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function PagerLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <Button variant="ghost" size="icon" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="ghost" size="icon" asChild>
      <ViewLink href={href} scroll={false} aria-label={label} icon>
        {children}
      </ViewLink>
    </Button>
  );
}

function Figures({ totals }: { totals: Totals }) {
  const figures = [
    ["Potential", totals.potential, "revenue-potential"],
    ["Achieved", totals.achieved, "revenue-achieved"],
    ["Remaining", totals.remaining, "revenue-remaining"],
  ] as const;
  // v2.5 (R3): what of Remaining waits on held projects, inside Remaining: neither earned nor lost.
  const onHold = onHoldText(totals.onHold);
  return (
    <dl className={REVENUE_FIGURES} data-slot="revenue-figures">
      {figures.map(([label, value, slot]) => (
        <div key={slot} className={REVENUE_FIGURE} data-slot={slot}>
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="font-medium break-words tabular-nums">{formatRupees(value)}</dd>
          {slot === "revenue-remaining" && onHold ? (
            <dd
              className="text-muted-foreground text-xs break-words tabular-nums"
              data-slot="revenue-on-hold"
            >
              {onHold}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/** What the Owner should look at first: each row names its client and project and opens it. */
function NeedsALook({ exceptions }: { exceptions: RevenueException[] }) {
  return (
    <section aria-labelledby="revenue-needs-a-look" className={REVENUE_SECTION}>
      <h2 id="revenue-needs-a-look" className="text-sm font-medium">
        Needs a look
      </h2>
      <ul className={REVENUE_CARD} data-slot="revenue-exceptions">
        {exceptions.map((exception) => (
          <li key={exception.key}>
            <DrillLink
              href={exception.href}
              data-slot="revenue-exception"
              data-kind={exception.kind}
              className={cn(REVENUE_LINE, ROW_FOCUS)}
            >
              <span className={REVENUE_LINE_TEXT}>
                <span className="font-medium break-words">{exception.text}</span>
                <span className="text-muted-foreground text-xs break-words">{exception.where}</span>
              </span>
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </DrillLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClientCard({ client }: { client: ClientGroup }) {
  const { totals } = client;
  return (
    <div className={REVENUE_CARD} data-slot="revenue-client">
      <div className={REVENUE_CLIENT_HEAD}>
        <h3 className="font-medium break-words">{client.clientName}</h3>
        <p className="text-muted-foreground text-xs break-words tabular-nums">
          Potential {formatRupees(totals.potential)} · Achieved {formatRupees(totals.achieved)} ·
          Remaining {formatRupees(totals.remaining)}
          {totals.onHold > 0 ? (
            <span data-slot="revenue-client-on-hold"> ({onHoldText(totals.onHold)})</span>
          ) : null}
        </p>
      </div>
      <ul className="divide-border divide-y">
        {client.lines.map((line) => (
          <li key={lineKey(line)}>
            <Line line={line} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A retainer's cycle or a one-time project: it opens the project at its Billing section. */
function Line({ line }: { line: RevenueLine }) {
  const notes = lineNotes(line);
  return (
    <DrillLink
      href={lineHref(line)}
      data-slot="revenue-line"
      data-kind={line.kind}
      className={cn(REVENUE_LINE, ROW_FOCUS)}
    >
      <span className={REVENUE_LINE_TEXT}>
        <span className="font-medium break-words">
          {line.projectName}
          {line.held ? <OnHoldBadge className="ml-1.5 align-middle" /> : null}
        </span>
        <span className="text-muted-foreground text-xs break-words" data-slot="revenue-line-status">
          {lineStatus(line)}
        </span>
        {/* v2.5: Billed / Not billed, and the Owner's adjustment, on every line. */}
        <span className="text-xs break-words" data-slot="revenue-line-billing">
          <span className={line.billed ? "text-muted-foreground" : undefined}>
            {lineBilling(line)}
          </span>
          {line.adjusted ? (
            <span className="text-muted-foreground" data-slot="revenue-line-adjusted">
              {" "}
              · Adjusted
            </span>
          ) : null}
        </span>
        {notes.length > 0 ? (
          <span className="text-xs break-words tabular-nums" data-slot="revenue-line-notes">
            {notes.join(" · ")}
          </span>
        ) : null}
      </span>
      <span className={REVENUE_LINE_FIGURE}>
        <span
          data-slot="revenue-line-figure"
          className={cn(
            "tabular-nums",
            line.amount === null && line.potential === 0 ? "text-muted-foreground" : "font-medium",
          )}
        >
          {lineFigure(line)}
        </span>
        {line.achieved > 0 ? (
          <span
            className="text-muted-foreground text-xs tabular-nums"
            data-slot="revenue-line-achieved"
          >
            {formatRupees(line.achieved)} achieved
          </span>
        ) : null}
      </span>
    </DrillLink>
  );
}
