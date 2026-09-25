"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type Row,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { CARD_ROW_MIN_H, CARD_ROW_PADDING, CARD_ROW_TITLE, CARD_ROW_TRAILING } from "./row-metrics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/primitives/table";

import { EmptyState } from "./empty-state";
import { LoadingState } from "./loading-state";

/**
 * A checkbox column for row selection. Spread it first in `columns` and pass
 * `rowSelection` / `onRowSelectionChange` to the table; render a `BulkBar` from the selection.
 */
export function selectionColumn<TData>(): ColumnDef<TData> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
        aria-label="Select all rows on this page"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(value === true)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    size: 32,
  };
}

/**
 * How a row looks as a **card on a phone** (ARCHITECTURE §14.1: "Tables become cards below
 * 768px … horizontal scrolling inside a table is not acceptable").
 *
 * A card carries only what identifies the row and the one thing you need at a glance; every
 * other column — email, dates, secondary fields — lives in the detail sheet, where the actions
 * are too. Desktop and mobile are allowed to be different screens built from the same data.
 */
export type MobileCard<TData> = {
  /** The line that identifies the row: a name, a title. */
  title: (row: TData) => ReactNode;
  /** One quieter line beneath it: a job title, a client, a date. */
  subtitle?: (row: TData) => ReactNode;
  /** The glance: a `StatusDot`, or the one number that matters. */
  trailing?: (row: TData) => ReactNode;
  /** The rest of the row. Without it the card is not tappable and has no sheet. */
  detail?: (row: TData) => ReactNode;
  /** Heading for the sheet; defaults to `title`. */
  detailTitle?: (row: TData) => ReactNode;
  /** Actions inside the sheet, stacked full width. */
  actions?: (row: TData) => ReactNode;
};

export type DataTableProps<TData> = {
  columns: ColumnDef<TData>[];
  data: TData[];
  /** Stable id per row, needed for selection to survive sorting and paging. */
  getRowId?: (row: TData) => string;
  isLoading?: boolean;
  /** Shown when `data` is empty and not loading. Defaults to a plain "Nothing here yet". */
  emptyState?: ReactNode;
  /** Page size; `0` disables paging. */
  pageSize?: number;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  onRowClick?: (row: Row<TData>) => void;
  /** Accessible summary of the table, e.g. "Pending approvals". */
  caption: string;
  /** The card shape used below `md`. Without it the table still scrolls sideways on a phone. */
  mobile?: MobileCard<TData>;
  /** Cards shown before "Show more"; mobile shows fewer rows with a clearer next step (§14.1). */
  mobilePageSize?: number;
  className?: string;
};

/**
 * Sortable, paged table on TanStack Table v8 with optional row selection. Server-side
 * paging is the pattern for large lists (ARCHITECTURE: indexed and paginated lists); this
 * component pages what it's given, which is right for inbox-sized lists.
 */
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  isLoading = false,
  emptyState,
  pageSize = 25,
  rowSelection,
  onRowSelectionChange,
  onRowClick,
  caption,
  mobile,
  mobilePageSize = 10,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalSelection, setInternalSelection] = useState<RowSelectionState>({});
  const selection = rowSelection ?? internalSelection;
  const setSelection = onRowSelectionChange ?? setInternalSelection;

  // TanStack Table returns functions the React Compiler can't memoize; skipping this component is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection: selection },
    onSortingChange: setSorting,
    onRowSelectionChange: setSelection,
    enableRowSelection:
      Boolean(rowSelection || onRowSelectionChange) || columns.some((c) => c.id === "select"),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(pageSize > 0
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageSize } },
        }
      : {}),
    ...(getRowId ? { getRowId } : {}),
  });

  const rows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const showPager = pageSize > 0 && pageCount > 1;

  if (!isLoading && data.length === 0) {
    return (
      <div className={className}>
        {emptyState ?? <EmptyState title="Nothing here yet" size="compact" />}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {mobile ? (
        <MobileCards
          rows={rows}
          card={mobile}
          isLoading={isLoading}
          pageSize={mobilePageSize}
          caption={caption}
        />
      ) : null}
      <div
        className={cn(
          "border-border bg-card max-h-[70dvh] overflow-auto rounded-lg border",
          // A phone gets the cards above instead; the table is never side-scrolled (§14.1).
          mobile && "hidden md:block",
        )}
      >
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader className="bg-card sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--border)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      style={header.getSize() !== 150 ? { width: header.getSize() } : undefined}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="hover:text-foreground focus-visible:ring-ring -mx-1 inline-flex items-center gap-1 rounded px-1 outline-none focus-visible:ring-2"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUpIcon className="size-3.5" aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon className="size-3.5" aria-hidden />
                          ) : null}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: Math.min(pageSize || 5, 5) }, (_, i) => (
                  <TableRow key={`skeleton-${i}`} aria-hidden>
                    {columns.map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-3/4" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      {showPager ? (
        <div
          className={cn(
            "text-muted-foreground flex items-center justify-between gap-2 text-sm",
            // The cards have their own "Show more"; page arrows are a desktop control.
            mobile && "hidden md:flex",
          )}
        >
          <span className="tabular-nums">
            Page {table.getState().pagination.pageIndex + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeftIcon aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRightIcon aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The phone rendering of a table: a list of cards, and a bottom sheet for the row you tap.
 *
 * Ten cards with a clear next step rather than fifty dense rows — density follows the device
 * (ARCHITECTURE §14.1). The table and the cards are swapped by CSS rather than by a media-query
 * hook, so the server and the first client render agree and nothing flashes on load; the hidden
 * one is `display: none`, so it is out of the accessibility tree too.
 */
function MobileCards<TData>({
  rows,
  card,
  isLoading,
  pageSize,
  caption,
}: {
  rows: Row<TData>[];
  card: MobileCard<TData>;
  isLoading: boolean;
  pageSize: number;
  caption: string;
}) {
  const [shown, setShown] = useState(pageSize);
  const [openId, setOpenId] = useState<string | null>(null);

  const open = rows.find((row) => row.id === openId) ?? null;
  const visible = rows.slice(0, shown);
  const remaining = rows.length - visible.length;

  if (isLoading) {
    // The same component the route's loading.tsx uses, so the streamed fallback and the
    // in-place loading state are the same drawing (ARCHITECTURE §14.1).
    return (
      <LoadingState
        shape="cards"
        count={Math.min(pageSize, 4)}
        label={caption}
        className="md:hidden"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 md:hidden">
      <ul
        data-slot="data-cards"
        aria-label={caption}
        className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
      >
        {visible.map((row) => {
          const body = (
            <>
              <span className={cn("flex flex-col gap-0.5 text-left", CARD_ROW_TITLE)}>
                <span className="truncate text-sm font-medium">{card.title(row.original)}</span>
                {card.subtitle ? (
                  <span className="text-muted-foreground truncate text-xs">
                    {card.subtitle(row.original)}
                  </span>
                ) : null}
              </span>
              {card.trailing ? (
                <span className={CARD_ROW_TRAILING}>{card.trailing(row.original)}</span>
              ) : null}
            </>
          );

          return (
            <li key={row.id} data-slot="data-card">
              {card.detail ? (
                <button
                  type="button"
                  onClick={() => setOpenId(row.id)}
                  className={cn(
                    "active:bg-muted/60 focus-visible:ring-ring flex w-full flex-wrap items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset",
                    CARD_ROW_MIN_H,
                    CARD_ROW_PADDING,
                  )}
                >
                  {body}
                  <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </button>
              ) : (
                <div
                  className={cn(
                    "flex w-full flex-wrap items-center gap-3",
                    CARD_ROW_MIN_H,
                    CARD_ROW_PADDING,
                  )}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {remaining > 0 ? (
        <Button
          variant="outline"
          onClick={() => setShown((current) => current + pageSize)}
          data-slot="data-cards-more"
        >
          Show {Math.min(remaining, pageSize)} more
        </Button>
      ) : null}

      <Sheet open={open !== null} onOpenChange={(next) => (next ? null : setOpenId(null))}>
        <SheetContent
          side="bottom"
          data-slot="detail-sheet"
          className="max-h-[85dvh] gap-4 overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]"
        >
          <div
            aria-hidden
            className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
          />
          {open ? (
            <>
              <SheetHeader className="pt-3 pr-12 pb-0">
                <SheetTitle>{(card.detailTitle ?? card.title)(open.original)}</SheetTitle>
                <SheetDescription className="sr-only">Details and actions</SheetDescription>
              </SheetHeader>
              {card.detail ? (
                <div data-slot="detail-sheet-body" className="px-4 text-sm">
                  {card.detail(open.original)}
                </div>
              ) : null}
              {/*
                `card.actions` is a function, so testing it says nothing about whether this row
                has any: an Admin sees every card but may act on none (PERMISSIONS §2), and that
                rendered an empty bordered block.
              */}
              {card.actions?.(open.original) ? (
                <div
                  data-slot="detail-sheet-actions"
                  // Any action closes the sheet: the ones that go on to open a dialog would
                  // otherwise leave it stacked behind, and the rest are finished by then.
                  onClick={() => setOpenId(null)}
                  className="border-border flex flex-col gap-2 border-t px-4 pt-4 *:w-full *:justify-start"
                >
                  {card.actions(open.original)}
                </div>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
