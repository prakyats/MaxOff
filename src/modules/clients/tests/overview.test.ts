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

  it("the Owner's notes when the key is there, null when it is empty", async () => {
    fake.answer = { ...EMPTY, owner_notes: "Pays late" };
    expect((await readClientOverview("k-owner")).ownerNotes).toBe("Pays late");
    fake.answer = { ...EMPTY, owner_notes: null };
    expect((await readClientOverview("k-owner-empty")).ownerNotes).toBeNull();
  });
});
