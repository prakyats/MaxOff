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
  holdReadsUntil: (promise: Promise<unknown>) => {
    const hold = { settled: false };
    holds.push(hold);
    promise.then(
      () => (hold.settled = true),
      () => (hold.settled = true),
    );
  },
}));

const { getSessionState, readBeforeCheck } = await import("./server");

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

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  jar.clear();
  reads.length = 0;
  tokens.length = 0;
  holds.length = 0;
  left = undefined;
  getClaims.mockReset();
  answers.token = async () => ({ data: row("m-1"), error: null });
  answers.session = async () => ({ data: row("m-1"), error: null });
  rpcAnswers.token = async () => ({ data: "early", error: null, status: 200 });
  rpcAnswers.session = async () => ({ data: "usual", error: null, status: 200 });
});

describe("getSessionState: the member row's request leaves first (6b.19)", () => {
  it("sends the row's request before the JWT check settles, with the cookie's token", async () => {
    const token = tokenFor("m-1");
    signIn(token);
    let verify: (value: unknown) => void = () => undefined;
    getClaims.mockReturnValue(new Promise((resolve) => (verify = resolve)));

    const state = getSessionState();
    await settle();
    // Exactly one request, already out, while the check is still pending.
    expect(reads).toEqual([{ client: "token", table: "members", id: "m-1" }]);
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

  it("reads again the usual way when the early read failed", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    answers.token = async () => ({ data: null, error: { message: "JWT expired" } });
    await expect(getSessionState()).resolves.toMatchObject({ kind: "member" });
    expect(reads.map((read) => read.client)).toEqual(["token", "session"]);
  });

  it("keeps a failure of the usual read a retryable error, never 'inactive'", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    answers.token = async () => ({ data: null, error: { message: "timeout" } });
    answers.session = async () => ({ data: null, error: { message: "timeout" } });
    await expect(getSessionState()).rejects.toMatchObject({ message: "timeout" });
  });

  it("uses only the verified id: a token claiming someone else is read again by the verified id", async () => {
    signIn(tokenFor("someone-else"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    answers.token = async () => ({ data: row("someone-else"), error: null });
    await expect(getSessionState()).resolves.toMatchObject({ member: { id: "m-1" } });
    expect(reads.at(-1)).toEqual({ client: "session", table: "members", id: "m-1" });
  });

  it("makes no early read without a session cookie", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(getSessionState()).resolves.toEqual({ kind: "none" });
    expect(reads).toEqual([]);
  });
});

/**
 * The row and the other first-byte reads leave before every later client's first request (v1.9
 * speed gate, 2026-11-03; ARCHITECTURE §19 "Six connections"): the hold is registered before
 * anything is awaited, settles once the read's request has gone out, and never outlives a read
 * that sends nothing.
 */
describe("the first reads hold every later client until they have left", () => {
  it("registers the hold at once and settles it when the row's request goes out", async () => {
    signIn(tokenFor("m-1"));
    let verify: (value: unknown) => void = () => undefined;
    getClaims.mockReturnValue(new Promise((resolve) => (verify = resolve)));
    answers.token = () => new Promise(() => undefined); // the row never answers

    const state = getSessionState();
    // Registered synchronously: a page read started in the same tick sees it.
    expect(holds).toHaveLength(1);
    expect(holds[0]?.settled).toBe(false);
    await settle();
    // The request is out (the read is pending), and that alone released the hold.
    expect(reads).toEqual([{ client: "token", table: "members", id: "m-1" }]);
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

  it("holds once per first-byte read: the own day's read registers its own", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    type EarlyClient = Parameters<Parameters<typeof readBeforeCheck>[0]>[0];
    const answer = readBeforeCheck(
      (supabase: EarlyClient) =>
        supabase.rpc("attendance_own_today") as unknown as Promise<RpcAnswer>,
    );
    expect(holds).toHaveLength(1);
    expect(holds[0]?.settled).toBe(false);
    await expect(answer).resolves.toMatchObject({ data: "early" });
    await settle();
    expect(holds[0]?.settled).toBe(true);
  });
});

/**
 * The reads the layout's first byte waits for besides the row (the push status, the own day) leave
 * the same way (v1.9 speed gate, 2026-11-03): before the check, counted only once it verified.
 */
describe("readBeforeCheck: a first-byte read leaves before the JWT check", () => {
  type EarlyClient = Parameters<Parameters<typeof readBeforeCheck>[0]>[0];
  // The mock client answers `RpcAnswer` (above), not the generated builder type.
  const ownDay = (supabase: EarlyClient) =>
    supabase.rpc("attendance_own_today") as unknown as Promise<RpcAnswer>;

  it("sends the read before the check settles, with the cookie's token, and keeps its answer", async () => {
    const token = tokenFor("m-1");
    signIn(token);
    let verify: (value: unknown) => void = () => undefined;
    getClaims.mockReturnValue(new Promise((resolve) => (verify = resolve)));

    const answer = readBeforeCheck(ownDay);
    await settle();
    expect(reads).toEqual([{ client: "token", table: "attendance_own_today", id: null }]);
    expect(tokens).toEqual([token]);

    verify({ data: { claims: { sub: "m-1" } }, error: null });
    await expect(answer).resolves.toMatchObject({ data: "early" });
    expect(reads).toHaveLength(1);
  });

  it("asks again the usual way when PostgREST refused the token (401)", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    rpcAnswers.token = async () => ({ data: null, error: { message: "JWT expired" }, status: 401 });
    await expect(readBeforeCheck(ownDay)).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["token", "session"]);
  });

  it("asks again the usual way when the token claims someone the check did not verify", async () => {
    signIn(tokenFor("someone-else"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    await expect(readBeforeCheck(ownDay)).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["token", "session"]);
  });

  it("never counts the early answer for a session that does not verify", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(readBeforeCheck(ownDay)).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["token", "session"]);
  });

  it("keeps any other answer, its error included, without asking twice", async () => {
    signIn(tokenFor("m-1"));
    getClaims.mockResolvedValue({ data: { claims: { sub: "m-1" } }, error: null });
    rpcAnswers.token = async () => ({ data: null, error: { message: "no day" }, status: 400 });
    await expect(readBeforeCheck(ownDay)).resolves.toMatchObject({ error: { message: "no day" } });
    expect(reads).toHaveLength(1);
  });

  it("makes no early read without a session cookie", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(readBeforeCheck(ownDay)).resolves.toMatchObject({ data: "usual" });
    expect(reads.map((read) => read.client)).toEqual(["session"]);
  });
});
