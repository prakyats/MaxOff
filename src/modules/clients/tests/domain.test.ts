import { describe, expect, it } from "vitest";

import { clientLifecycleActions, sortClients } from "../domain/clients";
import {
  archiveContactSchema,
  createClientSchema,
  parseBrandColors,
  parseBrandFonts,
  updateBrandSchema,
  updateClientSchema,
} from "../domain/schemas";

const uuid = "00000000-0000-4000-8000-000000000001";

describe("createClientSchema (kickoff 3 rules, mirrored from the table checks)", () => {
  it("needs a name and turns blanks into null", () => {
    const parsed = createClientSchema.parse({
      name: "  Sharma Weddings ",
      legalName: "",
      gstin: "",
      website: "",
      adminId: "",
    });
    expect(parsed.name).toBe("Sharma Weddings");
    expect(parsed.legalName).toBeNull();
    expect(parsed.gstin).toBeNull();
    expect(parsed.website).toBeNull();
    expect(parsed.adminId).toBeNull();
    expect(parsed.customFields).toEqual({});
    expect(createClientSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("checks the GSTIN format only when one is given, and upper-cases it", () => {
    expect(createClientSchema.parse({ name: "A", gstin: "27aapfu0939f1zv" }).gstin).toBe(
      "27AAPFU0939F1ZV",
    );
    const bad = createClientSchema.safeParse({ name: "A", gstin: "12345" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(["gstin"]);
  });

  it("accepts https links only", () => {
    expect(
      createClientSchema.parse({ name: "A", website: "https://x.example", driveUrl: "https://d/1" })
        .driveUrl,
    ).toBe("https://d/1");
    for (const value of ["http://x.example", "x.example", "https://with space"]) {
      expect(createClientSchema.safeParse({ name: "A", website: value }).success).toBe(false);
      expect(createClientSchema.safeParse({ name: "A", driveUrl: value }).success).toBe(false);
    }
  });

  it("validates email and phone loosely, as the table does", () => {
    expect(createClientSchema.parse({ name: "A", email: "Hi@Example.com" }).email).toBe(
      "hi@example.com",
    );
    expect(createClientSchema.safeParse({ name: "A", email: "nope" }).success).toBe(false);
    expect(createClientSchema.safeParse({ name: "A", phone: "12" }).success).toBe(false);
    expect(createClientSchema.parse({ name: "A", phone: "98450 12345" }).phone).toBe("98450 12345");
  });

  it("the update schema needs the client id", () => {
    expect(updateClientSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(updateClientSchema.safeParse({ clientId: uuid, name: "A" }).success).toBe(true);
  });
});

describe("contacts and brand", () => {
  it("archiving takes an optional next primary", () => {
    expect(
      archiveContactSchema.parse({ contactId: uuid, nextPrimaryId: "" }).nextPrimaryId,
    ).toBeNull();
    expect(archiveContactSchema.parse({ contactId: uuid, nextPrimaryId: uuid }).nextPrimaryId).toBe(
      uuid,
    );
  });

  it("brand colours are named hex values, upper-cased; fonts are families with a usage", () => {
    const parsed = updateBrandSchema.parse({
      clientId: uuid,
      colors: [{ name: "Rose", hex: "#e11d48" }],
      fonts: [{ family: "Inter", usage: "" }],
      toneOfVoice: "",
      brandNotes: "Warm",
    });
    expect(parsed.colors).toEqual([{ name: "Rose", hex: "#E11D48" }]);
    expect(parsed.fonts).toEqual([{ family: "Inter", usage: null }]);
    expect(parsed.toneOfVoice).toBeNull();
    expect(
      updateBrandSchema.safeParse({
        clientId: uuid,
        colors: [{ name: "Rose", hex: "red" }],
        fonts: [],
      }).success,
    ).toBe(false);
  });

  it("reads what the database holds, and an unexpected shape as empty", () => {
    expect(parseBrandColors([{ name: "Rose", hex: "#E11D48" }])).toEqual([
      { name: "Rose", hex: "#E11D48" },
    ]);
    expect(parseBrandColors("nope")).toEqual([]);
    expect(parseBrandFonts(null)).toEqual([]);
  });
});

describe("clientLifecycleActions (WORKFLOWS §4)", () => {
  it("offers only the moves a state allows", () => {
    expect(clientLifecycleActions("draft")).toEqual(["activate"]);
    expect(clientLifecycleActions("active")).toEqual(["pause", "close"]);
    expect(clientLifecycleActions("paused")).toEqual(["activate", "close"]);
    expect(clientLifecycleActions("inactive")).toEqual(["reactivate"]);
  });
});

describe("sortClients", () => {
  it("sorts by name, ignoring case", () => {
    expect(
      sortClients([{ name: "zeta" }, { name: "Alpha" }, { name: "beta" }]).map((c) => c.name),
    ).toEqual(["Alpha", "beta", "zeta"]);
  });
});

describe("updateClientSchema is a patch (3.4 review)", () => {
  it("takes one record's fields alone, and still refuses a blank name when one is sent", () => {
    const parsed = updateClientSchema.parse({ clientId: uuid, notes: "Pays late" });
    expect(parsed.notes).toBe("Pays late");
    expect(parsed.customFields).toBeUndefined();
    expect(updateClientSchema.safeParse({ clientId: uuid, name: " " }).success).toBe(false);
  });
});
