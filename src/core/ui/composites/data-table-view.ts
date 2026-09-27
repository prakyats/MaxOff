/**
 * The search and filters of a `DataTable` (3.4): pure, so the rules are unit-tested. They are
 * **view controls** (ARCHITECTURE §14.2 d): they change what the list shows and never add
 * history. A filter's id keeps the URL in sync with a replace (a refresh or a shared link keeps
 * the place); **the search text never enters the URL** (ARCHITECTURE §18.2: Workers Logs record
 * query strings; phase 3 review), it lives in the component's state.
 */

export type DataTableSearch<T> = {
  /** The input's accessible name, e.g. "Search clients". */
  label: string;
  placeholder?: string;
  /** The text a row is found by (its name, usually). */
  text: (row: T) => string;
};

export type DataTableFilterOption = { value: string; label: string };

export type DataTableFilter<T> = {
  /** Also the query parameter, e.g. `state`. */
  id: string;
  label: string;
  /** The first option is the widest ("All states"): "Show everything" picks it. */
  options: readonly DataTableFilterOption[];
  /** What the list shows with no parameter (the Owner's clients: Active, kickoff 3). */
  defaultValue: string;
  match: (row: T, value: string) => boolean;
};

export type DataTableView = { query: string; filters: Record<string, string> };

/** Where search text went before the phase 3 review: a link that still carries it is cleaned. */
const OLD_SEARCH_PARAM = "q";

/** Folds case and accents, so "sharma" finds "Sharmā" and "SHARMA". */
export function foldText(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** The view a URL asks for, with no search; an unknown filter value falls back to the default. */
export function viewFromParams<T>(
  params: { get: (key: string) => string | null },
  filters: readonly DataTableFilter<T>[],
): DataTableView {
  return {
    query: "",
    filters: Object.fromEntries(
      filters.map((filter) => {
        const asked = params.get(filter.id);
        const known = filter.options.some((option) => option.value === asked);
        return [filter.id, asked !== null && known ? asked : filter.defaultValue];
      }),
    ),
  };
}

/** True when a URL still carries search text from before the phase 3 review. */
export function carriesOldSearch(search: string): boolean {
  return new URLSearchParams(search).has(OLD_SEARCH_PARAM);
}

/** The query string for a view's filters: defaults are left out, and search text never goes in. */
export function paramsForView<T>(
  current: string,
  view: DataTableView,
  filters: readonly DataTableFilter<T>[],
): string {
  const params = new URLSearchParams(current);
  params.delete(OLD_SEARCH_PARAM);
  for (const filter of filters) {
    const value = view.filters[filter.id] ?? filter.defaultValue;
    if (value === filter.defaultValue) params.delete(filter.id);
    else params.set(filter.id, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The rows the view shows: every word of the search in the row's text, and every filter. */
export function applyView<T>(
  rows: readonly T[],
  view: DataTableView,
  search: DataTableSearch<T> | undefined,
  filters: readonly DataTableFilter<T>[],
): T[] {
  const words = foldText(view.query).split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (search && words.length > 0) {
      const text = foldText(search.text(row));
      if (!words.every((word) => text.includes(word))) return false;
    }
    return filters.every((filter) =>
      filter.match(row, view.filters[filter.id] ?? filter.defaultValue),
    );
  });
}

/** True when the view differs from what the list shows with no parameters. */
export function isNarrowed<T>(
  view: DataTableView,
  filters: readonly DataTableFilter<T>[],
): boolean {
  return (
    view.query.trim() !== "" ||
    filters.some(
      (filter) => (view.filters[filter.id] ?? filter.defaultValue) !== filter.defaultValue,
    )
  );
}
