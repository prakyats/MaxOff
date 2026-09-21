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

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/primitives/table";

import { EmptyState } from "./empty-state";

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
      <div className="border-border bg-card max-h-[70dvh] overflow-auto rounded-lg border">
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
        <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
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
