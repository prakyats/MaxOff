import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ answer: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    rpc: async () => ({ data: fake.answer, error: null }),
  }),
}));

import { readClientOverview } from "../data/clients";

const EMPTY = { contacts: [], open_tasks: 0, client_fields: [], contact_fields: [] };

/**
 * A client's Overview fold (v2.0 X3, `client_overview()`; X5+ M5). The Owner's notes are a key
 * only where RLS shows `client_private` (the Owner): an Admin's answer has no key at all, and
 * that is no notes, never an error.
 */
describe("readClientOverview", () => {
  it("no owner_notes key (an Admin): no notes, the other parts as given", async () => {
    fake.answer = { ...EMPTY, open_tasks: 3 };
    expect(await readClientOverview("k-admin")).toEqual({
      contacts: [],
      ownerNotes: null,
      openTasks: 3,
      clientFields: [],
      contactFields: [],
    });
  });

  it("a client the caller may not see: the fold's empty answer, never an error", async () => {
    // `client_overview()` is security invoker: for a client RLS hides, every part is empty (no
    // contacts, no owner_notes key, 0 open tasks); only the company-wide field definitions,
    // which RLS shows to every member, come back. Nothing of the hidden client leaks through.
    const companyWide = {
      id: "f-company",
      org_id: "o-1",
      entity: "client",
      client_id: null,
      task_type_id: null,
      key: "gst",
      label: "GST number",
      help_text: null,
      type: "text",
      options: null,
      position: "a0",
      required: false,
      section: null,
      archived_at: null,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    };
    fake.answer = { ...EMPTY, client_fields: [companyWide] };
    const overview = await readClientOverview("k-hidden");
    expect(overview).toMatchObject({
      contacts: [],
      ownerNotes: null,
      openTasks: 0,
      contactFields: [],
    });
    expect(overview.clientFields.map((field) => field.id)).toEqual(["f-company"]);
  });

  it("the Owner's notes when the key is there, null when it is empty", async () => {
    fake.answer = { ...EMPTY, owner_notes: "Pays late" };
    expect((await readClientOverview("k-owner")).ownerNotes).toBe("Pays late");
    fake.answer = { ...EMPTY, owner_notes: null };
    expect((await readClientOverview("k-owner-empty")).ownerNotes).toBeNull();
  });
});
