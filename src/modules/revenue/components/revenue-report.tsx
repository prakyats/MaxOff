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
  lineFigure,
  lineHref,
  lineKey,
  lineNotes,
  lineStatus,
  monthSwitcher,
  type RevenueException,
  revenueHref,
  type RevenueLine,
  type RevenueMonth,
  revenueView,
  type RevenueView,
  type Totals,
} from "../domain/revenue";
import {
  type ClosedRevenueView,
  closedRevenueMonth,
  closedRevenueView,
  type SnapshotRevenue,
} from "../domain/closed-month";
import { type CloseLink, closeHref, closeLink } from "../domain/month-close-view";

import { BillingRetry } from "./billing-retry";
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

/** An ended month's snapshot versions and the latest one's revenue section (`readMonthSnapshots`). */
type MonthSnapshots = {
  versions: readonly { version: number; closedAt: string }[];
  latest: SnapshotRevenue | null;
};

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
 *
 * **A closed month** (v3.5 U5) shows its latest version's figures in the same layout, each line's
 * billing status ("at close" and "now" only when they differ), and "Changed since close" under
 * the month when the live figures moved; that line opens the close screen, which says what moved.
 * When the snapshot read fails the page shows its error state rather than live figures that could
 * be taken for the saved report.
 */
export async function RevenueReport({
  read,
  category,
  snapshots = null,
}: {
  read: Promise<RevenueMonth>;
  category: CategoryFilter;
  /**
   * An ended month's snapshot versions and the latest one's revenue section (v3.5 U4, U5): the
   * month header's "Close month" or "Closed 3 Oct · v1", and a closed month's figures. Null for
   * this month (it cannot be closed yet).
   */
  snapshots?: Promise<MonthSnapshots> | null;
}) {
  let month: RevenueMonth;
  let ended: MonthSnapshots | null;
  let view: RevenueView;
  let closed: ClosedRevenueView | null = null;
  try {
    [month, ended] = await Promise.all([read, snapshots]);
    // v3.5 U5 (Q12): a closed month draws its latest version's figures; the live read still gives
    // the switcher, today's names, what needs a look, the billing status now and the change check.
    closed = ended?.latest
      ? closedRevenueView(closedRevenueMonth(ended.latest, month), month, category)
      : null;
    view = closed ?? revenueView(month, category);
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
  const close = ended ? closeLink(month.month, ended.versions) : null;
  const switcher = monthSwitcher(month);
  const href = (next: { month?: string; category?: CategoryFilter }) =>
    revenueHref(
      { month: next.month ?? month.month, category: next.category ?? category },
      month.thisMonth,
    );
  return (
    <div className={REVENUE_PAGE} data-slot="revenue" data-closed={closed ? "" : undefined}>
      <div className={REVENUE_PAGER} role="group" aria-label="Month" data-slot="revenue-month">
        <PagerLink
          href={switcher.previous ? href({ month: switcher.previous }) : null}
          label="Previous month"
        >
          <ChevronLeftIcon aria-hidden />
        </PagerLink>
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-2">
          <p
            className="min-w-0 text-center text-sm font-medium tabular-nums"
            aria-live="polite"
            data-slot="revenue-month-label"
          >
            {switcher.label}
          </p>
          {close ? <CloseMonthLink link={close} /> : null}
        </div>
        <PagerLink href={switcher.next ? href({ month: switcher.next }) : null} label="Next month">
          <ChevronRightIcon aria-hidden />
        </PagerLink>
      </div>
      {closed?.changed ? (
        <DrillLink
          href={closeHref(month.month)}
          data-slot="revenue-changed"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mt-2 inline-flex min-h-11 items-center justify-center self-center rounded-md px-2 text-center text-xs font-medium outline-none focus-visible:ring-2 md:min-h-8"
        >
          <span>
            <span className="text-foreground">Changed since close</span>
            <span aria-hidden> · </span>
            <span className="underline underline-offset-4">See Month close</span>
          </span>
        </DrillLink>
      ) : null}

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
                  <ClientCard
                    key={client.clientId}
                    client={client}
                    billing={closed?.billing ?? null}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The month header's way to the close screen (v3.5 Q11; WORKFLOWS §7.1): "Close month" for an
 * ended month not closed yet, "Closed 3 Oct · v1" for a closed one.
 */
function CloseMonthLink({ link }: { link: CloseLink }) {
  return (
    <DrillLink
      href={link.href}
      data-slot="revenue-close-link"
      data-closed={link.closed ? "" : undefined}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-1 text-xs font-medium underline underline-offset-4 outline-none focus-visible:ring-2 md:min-h-8"
    >
      {link.label}
    </DrillLink>
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
  return (
    <dl className={REVENUE_FIGURES} data-slot="revenue-figures">
      {figures.map(([label, value, slot]) => (
        <div key={slot} className={REVENUE_FIGURE} data-slot={slot}>
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="font-medium break-words tabular-nums">{formatRupees(value)}</dd>
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

function ClientCard({
  client,
  billing,
}: {
  client: ClientGroup;
  /** A closed month's billing status per line (v3.5 Q13); null for an open month. */
  billing: ReadonlyMap<string, string> | null;
}) {
  const { totals } = client;
  return (
    <div className={REVENUE_CARD} data-slot="revenue-client">
      <div className={REVENUE_CLIENT_HEAD}>
        <h3 className="font-medium break-words">{client.clientName}</h3>
        <p className="text-muted-foreground text-xs break-words tabular-nums">
          Potential {formatRupees(totals.potential)} · Achieved {formatRupees(totals.achieved)} ·
          Remaining {formatRupees(totals.remaining)}
        </p>
      </div>
      <ul className="divide-border divide-y">
        {client.lines.map((line) => (
          <li key={lineKey(line)}>
            <Line line={line} billing={billing?.get(lineKey(line)) ?? null} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A retainer's cycle or a one-time project: it opens the project at its Billing section. */
function Line({ line, billing }: { line: RevenueLine; billing: string | null }) {
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
          {billing ? (
            <>
              {" · "}
              <span data-slot="revenue-line-billing">{billing}</span>
            </>
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
