import { describe, expect, it } from "vitest";

import { type ActivityEntry, describeClientActivity, joinNouns } from "../domain/activity";
import { clientMenuMoves } from "../domain/clients";

function entry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 1,
    actorId: "owner",
    entity: "clients",
    entityId: "client",
    action: "update",
    old: {},
    new: {},
    meta: {},
    at: "2026-09-27T10:00:00Z",
    ...overrides,
  };
}

const context = {
  names: { owner: "Prishit Shetty", ravi: "Ravi", asha: "Asha" },
  contacts: { contact: "Meera" },
  showCloseReason: true,
};

describe("describeClientActivity (3.4)", () => {
  it("joins nouns the way a sentence does", () => {
    expect(joinNouns(["name"])).toBe("name");
    expect(joinNouns(["name", "phone", "website"])).toBe("name, phone and website");
  });

  it("names the fields a plain edit changed", () => {
    expect(
      describeClientActivity(entry({ new: { phone: "1", drive_url: "x" } }), context),
    ).toMatchObject({ actor: "Prishit Shetty", text: "changed the phone and Drive link" });
  });

  it("says who became the Admin, and from whom", () => {
    expect(
      describeClientActivity(
        entry({ action: "admin_assigned", meta: { from_admin_id: null, to_admin_id: "ravi" } }),
        context,
      )?.text,
    ).toBe("made Ravi the Admin");
    expect(
      describeClientActivity(
        entry({ action: "admin_assigned", meta: { from_admin_id: "ravi", to_admin_id: "asha" } }),
        context,
      )?.text,
    ).toBe("moved the client from Ravi to Asha");
  });

  it("says an Admin's new client was created Active (kickoff 7 amendment B)", () => {
    expect(
      describeClientActivity(
        entry({ actorId: "ravi", action: "created_active", meta: { admin_id: "ravi" } }),
        context,
      ),
    ).toMatchObject({ actor: "Ravi", text: "created the client, Active from the start" });
  });

  it("keeps the close reason for the Owner only", () => {
    const closed = entry({ action: "closed", meta: { reason: "Moved to another studio" } });
    expect(describeClientActivity(closed, context)).toMatchObject({
      text: "closed the client",
      note: "Moved to another studio",
    });
    expect(
      describeClientActivity(closed, { ...context, showCloseReason: false })?.note,
    ).toBeUndefined();
  });

  it("describes the logo and the contacts", () => {
    expect(
      describeClientActivity(
        entry({ entity: "client_brand", old: { logo_file_id: null }, new: { logo_file_id: "f" } }),
        context,
      )?.text,
    ).toBe("added the logo");
    expect(
      describeClientActivity(
        entry({ entity: "client_contacts", entityId: "contact", action: "primary_set" }),
        context,
      )?.text,
    ).toBe("made Meera the primary contact");
  });

  it("leaves out entries that only echo another", () => {
    expect(
      describeClientActivity(entry({ entity: "client_brand", action: "insert" }), context),
    ).toBeNull();
    expect(
      describeClientActivity(
        entry({ entity: "client_admin_assignments", action: "insert" }),
        context,
      ),
    ).toBeNull();
    expect(
      describeClientActivity(
        entry({ entity: "client_contacts", entityId: "contact", action: "primary_removed" }),
        context,
      ),
    ).toBeNull();
  });

  it("names the system when nobody acted", () => {
    expect(describeClientActivity(entry({ actorId: null, action: "paused" }), context)?.actor).toBe(
      "MaxOff",
    );
  });
});

describe("clientMenuMoves (3.4)", () => {
  it("offers Activate only once an Admin is assigned", () => {
    expect(clientMenuMoves({ state: "draft", adminId: null })).toEqual([]);
    expect(clientMenuMoves({ state: "draft", adminId: "ravi" })).toEqual(["activate"]);
    expect(clientMenuMoves({ state: "active", adminId: "ravi" })).toEqual(["pause", "close"]);
    expect(clientMenuMoves({ state: "inactive", adminId: "ravi" })).toEqual(["reactivate"]);
  });
});
