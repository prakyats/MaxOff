import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The member row leaves first (6b.19, ARCHITECTURE §19 "Six connections"): a Worker invocation
 * opens at most six subrequests at a time and queues the rest in start order, and every screen's
 * first byte waits for this row. These pin that its request is sent before the JWT check settles,
 * with the cookie's token and no session load in front of it, and that the answer counts only
 * once the session has verified, for the verified id.
 */

vi.mock("server-only", () => ({}));

const jar = new Map<string, string>();
/**
 * React's `cache()` as a request sees it: one value per request. Outside a render it memoises
 * nothing, so each test is one request: every memo is cleared before it.
 */
const memos: Array<() => void> = [];
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    let done = false;
    let value: R;
    memos.push(() => (done = false));
    return (...args: A): R => {
      if (!done) {
        done = true;
        value = fn(...args);
      }
      return value;
    };
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: () => undefined,
    delete: () => undefined,
  }),
}));

type Answer = { data: Record<string, unknown> | null; error: { message: string } | null };
type Read = { client: "token" | "session"; table: string; id: unknown };

const reads: Read[] = [];
const answers: Record<"token" | "session", () => Promise<Answer>> = {
  token: async () => ({ data: null, error: null }),
  session: async () => ({ data: null, error: null }),
};
const tokens: string[] = [];
const getClaims = vi.fn();
/** What `holdReadsUntil` was given, and whether each has settled (the read has left). */
const holds: { settled: boolean }[] = [];
/** Told by the token client when its read goes out (`createTokenSupabase`'s `left`). */
let left: (() => void) | undefined;

type RpcAnswer = { data: unknown; error: { message: string } | null; status: number };
const rpcAnswers: Record<"token" | "session", () => Promise<RpcAnswer>> = {
  token: async () => ({ data: "early", error: null, status: 200 }),
  session: async () => ({ data: "usual", error: null, status: 200 }),
};

function client(kind: "token" | "session") {
  const sent = () => {
    if (kind === "token") left?.();
  };
  return {
    rpc: (fn: string) => {
      reads.push({ client: kind, table: fn, id: null });
      sent();
      return rpcAnswers[kind]();
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, id: unknown) => ({
          maybeSingle: () => {
            reads.push({ client: kind, table, id });
            sent();
            return answers[kind]();
          },
        }),
      }),
    }),
  };
}

vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({ ...client("session"), auth: { getClaims } }),
  createTokenSupabase: (token: string, tell?: () => void) => {
    tokens.push(token);
    left = tell;
    return client("token");
  },
  runAsTokenRead: <R>(read: () => R) => read(),
  holdReadsUntil: (promise: Promise<unknown>) => {
    const hold = { settled: false };
    holds.push(hold);
    promise.then(
      () => (hold.settled = true),
      () => (hold.settled = true),
    );
  },
}));

const { getSessionState, readBeforeCheck, startShellRead } = await import("./server");

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const tokenFor = (sub: string) => `${b64({ alg: "ES256", kid: "k" })}.${b64({ sub })}.sig`;

function signIn(token: string): void {
  jar.set("sb-127-auth-token", `base64-${b64({ access_token: token, refresh_token: "r" })}`);
}

const row = (id: string) => ({
  id,
  email: "a@b.c",
  full_name: "Asha Rao",
  role: "admin",
  status: "active",
  avatar_file_id: null,
  job_title: null,
});

/** `session_early()`'s answer for `id` (v2.0 X3): the row, a day, the band. */
const early = (id: string) => ({
  member: row(id),
  own_day: { work_date: "2026-11-05", day_id: null },
  own_day_refused: null,
  push: { endpoints: [], band: null },
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  for (const reset of memos) reset();
  jar.clear();
  reads.length = 0;
  tokens.length = 0;
  holds.length = 0;
  left = undefined;
  getClaims.mockReset();
  answers.token = async () => ({ data: row("m-1"), error: null });
  answers.session = async () => ({ data: row("m-1"), error: null });
  rpcAnswers.token = async () => ({ data: early("m-1"), error: null, status: 200 });
  rpcAnswers.session = async () => ({ data: "usual", error: null, status: 200 });
});

describe("getSessionState: the shell's one early read leaves first (6b.19, v2.0 X3)", () => {
  it("sends session_early before the JWT check settles, with the cookie's token, and takes its row", async () => {
    startShellRead();
    const token = tokenFor("m-1");
    signIn(token);
    let verify: (value: unknown) => void = () => undefined;
    getClaims.mockReturnValue(new Promise((resolve) => (verify = resolve)));

    const state = getSessionState();
    await settle();
    // Exactly one request, already out, while the check is still pending.
    expect(reads).toEqual([{ client: "token", table: "session_early", id: null }]);
    expect(tokens).toEqual([token]);

    verify({ data: { claims: { sub: "m-1" } }, error: null });
    await expect(state).resolves.toMatchObject({ kind: "member", member: { id: "m-1" } });
    expect(reads).toHaveLength(1);
  });

  it("is signed out when the token does not verify, whatever the read answered", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(getSessionState()).resolves.toEqual({ kind: "none" });
  });

  it("is inactive when the early answer has no row (RLS showed none), without asking again", async () => {
    startShellRead();
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    rpcAnswers.token = async () => ({
      data: { ...early("m-1"), member: null },
      error: null,
      status: 200,
    });
    await expect(getSessionState()).resolves.toEqual({ kind: "inactive", userId: "m-1" });
    expect(reads).toHaveLength(1);
  });

  it("reads the row again the usual way when the early read failed", async () => {
    startShellRead();
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    rpcAnswers.token = async () => ({ data: null, error: { message: "JWT expired" }, status: 401 });
    await expect(getSessionState()).resolves.toMatchObject({ kind: "member" });
    expect(reads).toEqual([
      { client: "token", table: "session_early", id: null },
      { client: "session", table: "members", id: "m-1" },
    ]);
  });

  it("keeps a failure of the usual read a retryable error, never 'inactive'", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    // Whichever early read this request makes fails (the row alone, or the shell's).
    answers.token = async () => ({ data: null, error: { message: "timeout" } });
    rpcAnswers.token = async () => ({ data: null, error: { message: "timeout" }, status: 500 });
    answers.session = async () => ({ data: null, error: { message: "timeout" } });
    await expect(getSessionState()).rejects.toMatchObject({ message: "timeout" });
  });

  it("uses only the verified id: a token claiming someone else is read again by the verified id", async () => {
    startShellRead();
    signIn(tokenFor("someone-else"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    rpcAnswers.token = async () => ({ data: early("someone-else"), error: null, status: 200 });
    await expect(getSessionState()).resolves.toMatchObject({ member: { id: "m-1" } });
    expect(reads.at(-1)).toEqual({ client: "session", table: "members", id: "m-1" });
  });

  it("makes no early read without a session cookie", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(getSessionState()).resolves.toEqual({ kind: "none" });
    expect(reads).toEqual([]);
  });

  it("reads the member row alone when the layout started no shell read (a prefetch)", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    await expect(getSessionState()).resolves.toMatchObject({
      kind: "member",
      member: { id: "m-1" },
    });
    expect(reads).toEqual([{ client: "token", table: "members", id: "m-1" }]);
  });
});

/**
 * The early read leaves before every later client's first request (v1.9 speed gate, 2026-11-03;
 * ARCHITECTURE §19 "Six connections"): the hold is registered before anything is awaited,
 * settles once the read's request has gone out, and never outlives a read that sends nothing.
 */
describe("the early read holds every later client until it has left", () => {
  it("registers the hold at once and settles it when the request goes out", async () => {
    startShellRead();
    signIn(tokenFor("m-1"));
    let verify: (value: unknown) => void = () => undefined;
    getClaims.mockReturnValue(new Promise((resolve) => (verify = resolve)));
    rpcAnswers.token = () => new Promise(() => undefined); // it never answers

    const state = getSessionState();
    // Registered synchronously: a page read started in the same tick sees it.
    expect(holds).toHaveLength(1);
    expect(holds[0]?.settled).toBe(false);
    await settle();
    // The request is out (the read is pending), and that alone released the hold.
    expect(reads).toEqual([{ client: "token", table: "session_early", id: null }]);
    expect(holds[0]?.settled).toBe(true);
    verify({ data: { claims: { sub: "m-1" } }, error: null });
    void state;
  });

  it("releases the hold of a read that sends nothing (no session cookie)", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(getSessionState()).resolves.toEqual({ kind: "none" });
    expect(reads).toEqual([]);
    expect(holds).toHaveLength(1);
    await settle();
    expect(holds[0]?.settled).toBe(true);
  });
});

/**
 * The parts of the early read the layout's first byte waits for besides the row (the push status,
 * the own day): picked from `session_early()`'s answer once the check verified, the same id; the
 * usual read otherwise (v1.9 speed gate, v2.0 X3).
 */
describe("readBeforeCheck: a part of the early read, kept only once the check verified", () => {
  type Early = Parameters<Parameters<typeof readBeforeCheck>[0]>[0];
  type EarlyClient = Parameters<Parameters<typeof readBeforeCheck>[1]>[0];
  const ownDayPart = (answer: Early) =>
    answer.own_day
      ? { data: answer.own_day, error: null }
      : { data: null, error: { message: answer.own_day_refused } };
  // The mock client answers `RpcAnswer` (above), not the generated builder type.
  const ownDayRead = (supabase: EarlyClient) =>
    supabase.rpc("attendance_own_today") as unknown as Promise<RpcAnswer>;
  const ownDay = () => readBeforeCheck<unknown>(ownDayPart, ownDayRead);

  it("sends the early read before the check settles and keeps its part", async () => {
    const token = tokenFor("m-1");
    signIn(token);
    let verify: (value: unknown) => void = () => undefined;
    getClaims.mockReturnValue(new Promise((resolve) => (verify = resolve)));

    const answer = ownDay();
    await settle();
    expect(reads).toEqual([{ client: "token", table: "session_early", id: null }]);
    expect(tokens).toEqual([token]);

    verify({ data: { claims: { sub: "m-1" } }, error: null });
    await expect(answer).resolves.toMatchObject({ data: { work_date: "2026-11-05" } });
    expect(reads).toHaveLength(1);
  });

  it("keeps a refusal inside the answer (the Owner's own day) without asking twice", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    rpcAnswers.token = async () => ({
      data: { ...early("m-1"), own_day: null, own_day_refused: "FORBIDDEN" },
      error: null,
      status: 200,
    });
    await expect(ownDay()).resolves.toMatchObject({ error: { message: "FORBIDDEN" } });
    expect(reads).toHaveLength(1);
  });

  it("asks again the usual way when PostgREST refused the token (401)", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    rpcAnswers.token = async () => ({ data: null, error: { message: "JWT expired" }, status: 401 });
    await expect(ownDay()).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["token", "session"]);
  });

  it("asks again the usual way when the early read failed", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    rpcAnswers.token = async () => ({ data: null, error: { message: "timeout" }, status: 500 });
    await expect(ownDay()).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["token", "session"]);
  });

  it("asks again the usual way when the token claims someone the check did not verify", async () => {
    signIn(tokenFor("someone-else"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    await expect(ownDay()).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["token", "session"]);
  });

  it("never counts the early answer for a session that does not verify", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(ownDay()).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["token", "session"]);
  });

  it("makes no early read without a session cookie", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(ownDay()).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["session"]);
  });

  it("reads the usual way when the part is not in the answer (an older session_early)", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    const hours = await readBeforeCheck<unknown>(
      () => undefined,
      (supabase) => supabase.rpc("attendance_own_hours") as unknown as Promise<RpcAnswer>,
    );
    expect(hours).toMatchObject({ data: "usual" });
    expect(reads.map((read) => `${read.client}:${read.table}`)).toEqual([
      "token:session_early",
      "session:attendance_own_hours",
    ]);
  });

  it("shares the layout's shell read: the row, the own day and the push status are one request", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    startShellRead();
    await expect(getSessionState()).resolves.toMatchObject({ kind: "member" });
    await expect(ownDay()).resolves.toMatchObject({ data: { work_date: "2026-11-05" } });
    expect(reads).toEqual([{ client: "token", table: "session_early", id: null }]);
  });
});
