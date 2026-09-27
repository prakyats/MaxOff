import { describe, expect, it } from "vitest";

import {
  applyView,
  type DataTableFilter,
  foldText,
  isNarrowed,
  paramsForView,
  viewFromParams,
} from "./data-table-view";

type Row = { name: string; state: string };

const rows: Row[] = [
  { name: "Sharma Weddings", state: "active" },
  { name: "Kapoor Films", state: "paused" },
  { name: "Sharmā Studio", state: "inactive" },
];

const state: DataTableFilter<Row> = {
  id: "state",
  label: "State",
  options: [
    { value: "all", label: "All states" },
    { value: "active", label: "Active" },
    { value: "paused", label: "Paused" },
    { value: "inactive", label: "Inactive" },
  ],
  defaultValue: "active",
  match: (row, value) => value === "all" || row.state === value,
};
const search = { label: "Search", text: (row: Row) => row.name };

describe("DataTable view (3.4)", () => {
  it("defaults the filter when the URL says nothing or something unknown, and never reads a search", () => {
    expect(viewFromParams(new URLSearchParams(""), [state])).toEqual({
      query: "",
      filters: { state: "active" },
    });
    expect(viewFromParams(new URLSearchParams("state=bogus&q=kap"), [state])).toEqual({
      query: "",
      filters: { state: "active" },
    });
  });

  it("searches case- and accent-blind, every word", () => {
    expect(foldText(" Sharmā ")).toBe("sharma");
    const view = { query: "sharma", filters: { state: "all" } };
    expect(applyView(rows, view, search, [state]).map((r) => r.name)).toEqual([
      "Sharma Weddings",
      "Sharmā Studio",
    ]);
    expect(
      applyView(rows, { query: "sharma wed", filters: { state: "all" } }, search, [state]),
    ).toHaveLength(1);
  });

  it("applies the default filter", () => {
    expect(applyView(rows, { query: "", filters: {} }, search, [state])).toEqual([rows[0]]);
  });

  it("writes only the filters that differ from the defaults, keeping other parameters", () => {
    expect(paramsForView("", { query: "", filters: { state: "active" } }, [state])).toBe("");
    expect(paramsForView("page=2", { query: " kap ", filters: { state: "all" } }, [state])).toBe(
      "?page=2&state=all",
    );
  });

  it("never writes search text, and drops a search an old link carried (ARCHITECTURE §18.2)", () => {
    expect(paramsForView("q=kap", { query: "kap", filters: { state: "active" } }, [state])).toBe(
      "",
    );
  });

  it("knows when the list is narrowed", () => {
    expect(isNarrowed({ query: "", filters: { state: "active" } }, [state])).toBe(false);
    expect(isNarrowed({ query: "a", filters: { state: "active" } }, [state])).toBe(true);
    expect(isNarrowed({ query: "", filters: { state: "all" } }, [state])).toBe(true);
  });
});
