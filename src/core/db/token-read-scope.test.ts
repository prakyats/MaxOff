import { describe, expect, it } from "vitest";

import {
  assertNotInTokenRead,
  runAsTokenRead,
  TOKEN_READ_SESSION_CLIENT,
} from "./token-read-scope";

/**
 * The guard on the first reads' hold (v2.0 X2 review): outside production, a session client made
 * inside a token read throws, because it would wait on that read's own hold. Code outside the
 * read, running at the same time (the page's reads), is never caught by it.
 */
describe("the token read scope", () => {
  it("throws inside a token read, after an await too", async () => {
    expect(() => runAsTokenRead(() => assertNotInTokenRead())).toThrow(TOKEN_READ_SESSION_CLIENT);
    await expect(
      runAsTokenRead(async () => {
        await Promise.resolve();
        assertNotInTokenRead();
      }),
    ).rejects.toThrow(TOKEN_READ_SESSION_CLIENT);
  });

  it("never throws outside one, even while a token read is running", async () => {
    let release: () => void = () => undefined;
    const read = runAsTokenRead(() => new Promise<void>((resolve) => (release = resolve)));
    expect(() => assertNotInTokenRead()).not.toThrow();
    await Promise.resolve();
    expect(() => assertNotInTokenRead()).not.toThrow();
    release();
    await read;
    expect(() => assertNotInTokenRead()).not.toThrow();
  });
});
