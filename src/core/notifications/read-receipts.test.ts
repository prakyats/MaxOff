import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, type Result } from "@/core/errors";

import {
  readFailed,
  readInFlight,
  readsUnconfirmed,
  readIssued,
  readWritten,
  resetReadReceipts,
  rowReadShown,
  serverUnreadSeen,
  unreadShown,
} from "./read-receipts";
import { type ReadWritten, sendRead } from "./send-read";

/** A count the server made at `countedAt` (server ms). */
const server = (count: number, countedAt: number) => ({ count, countedAt });

describe("the bell's count on the device (owner decision 2026-10-01)", () => {
  beforeEach(() => resetReadReceipts());

  it("drops as soon as a read is issued, before the server answers", () => {
    serverUnreadSeen(server(5, 100));
    readIssued(2, []);
    expect(unreadShown(server(5, 100))).toBe(3);
    expect(readInFlight()).toBe(true);
  });

  it("stays dropped once written, until a count made after the write holds it", () => {
    serverUnreadSeen(server(5, 100));
    const token = readIssued(2, []);
    readWritten(token, 2, 150);
    expect(readInFlight()).toBe(false);
    // The page's count is still the one from before the write.
    expect(unreadShown(server(5, 100))).toBe(3);
    expect(readsUnconfirmed()).toBe(true);
    // The server's next count (a refresh, the live bell's confirmation) already leaves them out.
    serverUnreadSeen(server(3, 200));
    expect(readsUnconfirmed()).toBe(false);
    expect(unreadShown(server(3, 200))).toBe(3);
    // The page's old count is not taken twice: the confirmation is the newer truth.
    expect(unreadShown(server(5, 100))).toBe(3);
  });

  it("a count made while the write was in flight still drops it, never double", () => {
    serverUnreadSeen(server(5, 100));
    const token = readIssued(2, []);
    readWritten(token, 2, 150);
    // Counted before the write: still five on the server, the read comes off.
    serverUnreadSeen(server(5, 140));
    expect(unreadShown(server(5, 140))).toBe(3);
  });

  it("takes off what the server marked, not what it expected", () => {
    serverUnreadSeen(server(5, 100));
    const token = readIssued(2, []);
    readWritten(token, 3, 150);
    expect(unreadShown(server(5, 100))).toBe(2);
  });

  it("Mark all read empties the count at once and never goes below zero", () => {
    serverUnreadSeen(server(7, 100));
    const token = readIssued(Number.POSITIVE_INFINITY, "all");
    expect(unreadShown(server(7, 100))).toBe(0);
    readWritten(token, 7, 150);
    expect(unreadShown(server(7, 100))).toBe(0);
    // A new notification after it shows.
    serverUnreadSeen(server(1, 300));
    expect(unreadShown(server(1, 300))).toBe(1);
  });

  it("a failed write keeps the count until the server's next count, then restores it quietly", () => {
    serverUnreadSeen(server(5, 100));
    const token = readIssued(2, ["n1", "n2"]);
    readFailed(token);
    expect(readInFlight()).toBe(false);
    // Nothing jumps on the screen at the failure itself.
    expect(unreadShown(server(5, 100))).toBe(3);
    expect(rowReadShown("n1", 100)).toBe(true);
    // The next refresh: the server still has them unread, and so does the device.
    serverUnreadSeen(server(5, 200));
    expect(unreadShown(server(5, 200))).toBe(5);
    expect(rowReadShown("n1", 200)).toBe(false);
  });

  it("a row read on the device shows read in a list drawn before the write, not after", () => {
    serverUnreadSeen(server(3, 100));
    const token = readIssued(1, ["n1"]);
    expect(rowReadShown("n1", 100)).toBe(true);
    expect(rowReadShown("n2", 100)).toBe(false);
    readWritten(token, 1, 150);
    expect(rowReadShown("n1", 100)).toBe(true);
    expect(rowReadShown("n1", 200)).toBe(false);
  });

  it("Mark all read shows every row of the list read", () => {
    readIssued(Number.POSITIVE_INFINITY, "all");
    expect(rowReadShown("any", 100)).toBe(true);
  });

  it("a read the deep-link entry wrote while the page was drawn drops the bell by one", () => {
    serverUnreadSeen(server(4, 100));
    readWritten(readIssued(1, ["n1"]), 1, 150);
    expect(unreadShown(server(4, 100))).toBe(3);
    serverUnreadSeen(server(3, 200));
    expect(unreadShown(server(3, 200))).toBe(3);
  });

  it("an older count arriving late never replaces a newer one", () => {
    serverUnreadSeen(server(3, 200));
    serverUnreadSeen(server(9, 100));
    expect(unreadShown(server(9, 100))).toBe(3);
  });

  it("a bell that hydrates after Mark all read shows 0 at every step (CI 2026-10-01)", () => {
    // Under CPU load the shell's streamed bell can still be server HTML ("2") when the page's own
    // "All read" is drawn; it hydrates later with the page's count, made before the write.
    const page = server(2, 100);
    serverUnreadSeen(page);
    const token = readIssued(Number.POSITIVE_INFINITY, "all");
    expect(unreadShown(page)).toBe(0);
    readWritten(token, 2, 150);
    expect(unreadShown(page)).toBe(0);
    // The live bell's confirmation lands and lets the receipt go; the late bell still reads 0.
    serverUnreadSeen(server(0, 200));
    expect(readsUnconfirmed()).toBe(false);
    expect(unreadShown(page)).toBe(0);
  });
});

describe("sendRead: the write in the background", () => {
  beforeEach(() => resetReadReceipts());

  it("drops the count before the write answers, and keeps it dropped once written", async () => {
    serverUnreadSeen(server(4, 100));
    let answer: (result: Result<ReadWritten>) => void = () => undefined;
    const write = vi.fn(
      () =>
        new Promise<Result<ReadWritten>>((resolve) => {
          answer = resolve;
        }),
    );
    const sent = sendRead(1, ["n1"], write);
    expect(write).toHaveBeenCalledOnce();
    expect(unreadShown(server(4, 100))).toBe(3);
    answer(ok({ marked: 1, writtenAt: 150 }));
    await expect(sent).resolves.toBe(true);
    expect(readInFlight()).toBe(false);
    expect(unreadShown(server(4, 100))).toBe(3);
  });

  it("a refused write is restored by the next count, with nothing thrown", async () => {
    serverUnreadSeen(server(4, 100));
    const sent = sendRead(1, ["n1"], async () => ({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong." },
    }));
    await expect(sent).resolves.toBe(false);
    expect(unreadShown(server(4, 100))).toBe(3);
    serverUnreadSeen(server(4, 200));
    expect(unreadShown(server(4, 200))).toBe(4);
  });

  it("an unreachable server (the call throws) is restored the same way", async () => {
    serverUnreadSeen(server(4, 100));
    await expect(
      sendRead(2, [], () => Promise.reject(new TypeError("Failed to fetch"))),
    ).resolves.toBe(false);
    expect(readInFlight()).toBe(false);
    serverUnreadSeen(server(4, 200));
    expect(unreadShown(server(4, 200))).toBe(4);
  });
});
