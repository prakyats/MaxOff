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

function client(kind: "token" | "session") {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, id: unknown) => ({
          maybeSingle: () => {
            reads.push({ client: kind, table, id });
            return answers[kind]();
          },
        }),
      }),
    }),
  };
}

vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({ ...client("session"), auth: { getClaims } }),
  createTokenSupabase: (token: string) => {
    tokens.push(token);
    return client("token");
  },
}));

const { getSessionState } = await import("./server");

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
  getClaims.mockReset();
  answers.token = async () => ({ data: row("m-1"), error: null });
  answers.session = async () => ({ data: row("m-1"), error: null });
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
