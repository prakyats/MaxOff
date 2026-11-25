import { describe, expect, it } from "vitest";

import { uploaderContact } from "../domain/contact";

describe("the uploader's contact (Q14): MaxOff's own sending address", () => {
  it.each([
    ["MaxOff <studio@mail.maxoff.app>", "studio@mail.maxoff.app"],
    ["studio@mail.maxoff.app", "studio@mail.maxoff.app"],
    ["MaxOff <noreply@localhost>", null],
    ["", null],
    [undefined, null],
    ["not an address", null],
  ])("%s → %s", (from, contact) => {
    expect(uploaderContact(from)).toBe(contact);
  });
});
