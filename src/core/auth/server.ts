import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import {
  createServerSupabase,
  createTokenSupabase,
  holdReadsUntil,
  runAsTokenRead,
  type ServerSupabase,
} from "@/core/db/server";
import { once } from "@/core/db/first-reads";
import { systemClock } from "@/core/time";
import type { MemberRole } from "@/core/permissions";
import { displayName } from "@/core/lib/display-name";

import { formatHomeHint, HOME_HINT_COOKIE } from "./home-hint";
import { accessTokenFrom, unverifiedSubject } from "./warm";
import { LOGIN_PATH } from "./paths";
import { classifySessionError, SessionUnavailableError } from "./session-errors";
import type { CurrentMember } from "./types";

export const SIGN_OUT_INACTIVE_PATH = "/auth/signout?reason=inactive";

/**
 * What the request's cookies resolve to.
 * - `none`: no verified Supabase session.
 * - `inactive`: a session whose member row is missing, invited or deactivated. Every table is
 *   already closed to them (`app.current_member()` returns no row), and the app treats it as
 *   signed out: `requireMember()` ends the session through `/auth/signout`.
 * - `member`: an active member.
 */
export type SessionState =
  | { kind: "none" }
  | { kind: "inactive"; userId: string }
  | { kind: "member"; member: CurrentMember };

/**
 * Resolves the session once per request (React `cache()`): the JWT is verified with
 * `getClaims()` (JWKS, no round trip once cached) and the member row is read under RLS (own row
 * only). Sets no Sentry user: the server never does (ARCHITECTURE §18.2).
 *
 * **The row's request leaves first** (6b.19, P2 2026-10-16, ARCHITECTURE §19 "Six connections"):
 * a Worker invocation keeps at most six subrequests open and queues the rest in the order they
 * were started. The row used to be asked only after the JWT check, which made it the last of a
 * screen's wave (7 to 12 reads) to set off, so it waited a whole round trip in that queue while
 * every screen's first byte waits for it. It is now started at once, with the cookie's access
 * token as it is (`createTokenSupabase`: no session load in front of the request) and filtered by
 * the `sub` that token claims (`unverifiedSubject`), while the check runs. That is a filter, never
 * a decision: PostgREST verifies the same token and RLS decides the row, the answer is used only
 * once `getClaims()` has verified the session, and only when the verified id is the row's (a
 * token that does not verify is `none` whatever came back). When the early read failed (say the
 * token it carried had just expired and `getClaims()` renewed it) the row is read again the usual
 * way, whose failure is the retryable error as before.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  // The shell's read when this request's layout started it; the member row alone otherwise.
  const early = shellRead().early ?? startMemberRowRead();
  const userId = await getSessionUserId();
  if (!userId) return { kind: "none" };
  const started = await early;
  const { data: row, error } =
    started && started.id === userId && !started.result.error && started.result.data
      ? { data: started.result.data.member, error: null }
      : await readMemberRow(await createServerSupabase(), userId);
  // A failed query (timeout, paused project) must never read as "inactive": that path ends
  // the session. Let the error boundary show a retryable error instead.
  if (error) throw error;

  if (!row || row.id !== userId || row.status !== "active") return { kind: "inactive", userId };

  return {
    kind: "member",
    member: {
      id: row.id,
      email: row.email,
      role: row.role,
      name: displayName(row.full_name),
      jobTitle: row.job_title?.name ?? null,
      avatarFileId: row.avatar_file_id,
    },
  };
});

const MEMBER_ROW = "id, email, full_name, role, status, avatar_file_id, job_title:list_items(name)";

function readMemberRow(supabase: Pick<ServerSupabase, "from">, id: string) {
  return supabase.from("members").select(MEMBER_ROW).eq("id", id).maybeSingle();
}

type MemberRow = NonNullable<Awaited<ReturnType<typeof readMemberRow>>["data"]>;

/**
 * `session_early()`'s answer (v2.0 X3, DATA-MODEL §1 "v2.0 X3"): the shell's three first-byte
 * reads in one, the caller's own only. `member` as `readMemberRow` reads it (under RLS); `own_day`
 * as `attendance_own_today()` answers, or null with `own_day_refused` naming the refusal it would
 * raise; `push` as `push_status_own()` answers.
 */
export type SessionEarly = {
  member: MemberRow | null;
  own_day: Record<string, unknown> | null;
  own_day_refused: string | null;
  push: { endpoints: string[] | null; band: string | null } | null;
  /** `attendance_own_hours()`'s row where `own_day` is answered, else null (v2.0 X3 step 3). */
  own_hours?: Record<string, unknown> | null;
};

/** What a read started before the JWT check gets: a client and the id the token claims. */
type EarlyClient = Pick<ServerSupabase, "from" | "rpc">;

/**
 * A read started before the JWT check settles (see `getSessionState`): with the session cookie's
 * access token and keyed by the `sub` it claims, both unverified. Null without a token. Never
 * rejects: a failure is the read's `error`, looked at only once the session has verified.
 *
 * **It leaves before every later client's first request** (v1.9 speed gate, 2026-11-03;
 * ARCHITECTURE §19 "Six connections"): `holdReadsUntil` is told, before anything is awaited, to
 * hold every `createServerSupabase()` made after this call until this read's request has been
 * handed to `fetch` (`createTokenSupabase`'s `left`). A read that sends nothing (no session
 * cookie, a cookie that is not a session, a read that threw) releases the hold when it returns,
 * so nothing waits on it. `read` uses only the client it is given: a `createServerSupabase()`
 * inside it would wait on this very hold, so outside production it throws (`runAsTokenRead`), and
 * in production `FIRST_READS_WAIT_MS` bounds the wait.
 */
function startTokenRead<R>(
  read: (supabase: EarlyClient, claimedId: string) => PromiseLike<R>,
): Promise<{ id: string; result: R } | null> {
  // Told by the fetch wrapper and again in `finally`: once is enough, any later call is harmless.
  let left: () => void = () => undefined;
  holdReadsUntil(
    new Promise<void>((resolve) => {
      left = once(resolve);
    }),
  );
  return (async () => {
    try {
      const token = await accessTokenFrom((await cookies()).getAll());
      const id = token ? unverifiedSubject(token) : null;
      if (!token || !id) return null;
      const supabase = createTokenSupabase(token, left);
      return { id, result: await runAsTokenRead(() => read(supabase, id)) };
    } catch {
      return null;
    } finally {
      left();
    }
  })();
}

/**
 * The shell's **one** early read (v2.0 X3, ARCHITECTURE §19 "Six connections"):
 * `session_early()`, the member row, the own day and the push status in one round trip, started
 * before the JWT check settles, once per request (`cache()`). A request whose `(app)` layout does
 * not render (a router prefetch) reads the member row alone (`startShellRead`). Every route's first wave was these
 * three plus the counts before the page's own; it is now one plus the counts.
 */
/** `session_early()` as one early token read. */
function startSessionEarlyRead() {
  return startTokenRead(async (supabase) => {
    const answer = await supabase.rpc("session_early");
    return {
      data: (answer.data as SessionEarly | null) ?? null,
      error: answer.error,
      status: answer.status,
    };
  });
}

/**
 * Whether this runs inside a render, where React's `cache()` keeps one value per request (a page,
 * a layout). In a route handler or a server action `cache()` keeps nothing, so each call gets a
 * fresh object: nothing there could share the shell's early read.
 */
const renderMark = cache((): object => ({}));
function inRender(): boolean {
  return renderMark() === renderMark();
}

/** This request's shell read, once started (`startShellRead`, `sessionEarly`). */
const shellRead = cache((): { early: ReturnType<typeof startSessionEarlyRead> | null } => ({
  early: null,
}));

/**
 * Starts the shell's early read for this request: the `(app)` layout's first line. Only a full
 * page request renders that layout; a router prefetch renders the segments below it, so a
 * prefetch never starts it and its `getSessionState` reads the member row alone, as it always did
 * (prefetch-likely: every row in view is prefetched, and `session_early()` also works out the own
 * day and the push status, which a loading boundary never needs).
 */
export function startShellRead(): void {
  void sessionEarly();
}

function sessionEarly(): ReturnType<typeof startSessionEarlyRead> {
  const state = shellRead();
  state.early ??= startSessionEarlyRead();
  return state.early;
}

/** The member row's read alone, started before the JWT check settles (a prefetch, an action). */
function startMemberRowRead() {
  return startTokenRead(async (supabase, id) => {
    const row = await readMemberRow(supabase, id);
    return {
      data: row.error
        ? null
        : ({ member: row.data, own_day: null, own_day_refused: null, push: null } as SessionEarly),
      error: row.error,
      status: row.status,
    };
  });
}

/**
 * A part of the shell's early read (`session_early()`, v2.0 X3) that the layout's first byte
 * waits for: the band's push status, the Start-day prompt's own day. The same guarantees as the
 * member row (6b.19; ARCHITECTURE §19 "Six connections"): PostgREST verifies the token and RLS
 * decides the answer, which is used only once `getClaims()` has verified the session, only when
 * the verified id is the one the token claimed and only when the early read answered; otherwise
 * (no session, another id, a token PostgREST refused, an early read that failed or threw) `read`
 * runs the usual way, exactly as before. `pick` takes the part out of the early answer, a refusal
 * included (the Owner's own day: refused, never asked again).
 */
export async function readBeforeCheck<T>(
  // `undefined`: this part is not in the answer (an older `session_early()`): read the usual way.
  pick: (early: SessionEarly) => { data: T | null; error: unknown } | undefined,
  read: (supabase: EarlyClient) => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  // Outside a render (a route handler, a server action) nothing is shared: the early read would
  // be the whole shell (`session_early()`) for one part, so the part is read alone, as on v1.9
  // (X6 review batch 2: a Start-day late-rule call made session_early plus two member rows).
  if (!inRender()) return read(await createServerSupabase());
  const early = sessionEarly();
  const userId = await getSessionUserId();
  const started = await early;
  const picked =
    started &&
    userId &&
    started.id === userId &&
    started.result.status !== 401 &&
    !started.result.error &&
    started.result.data
      ? pick(started.result.data)
      : undefined;
  return picked ?? read(await createServerSupabase());
}

/**
 * The verified session's user id (the member id), or `null`: the JWT alone, **no round trip**
 * (`getClaims()` verifies locally once the JWKS is cached). Performance rule (ARCHITECTURE §19):
 * a page starts the reads keyed by the viewer's id together with `requireMember()` /
 * `requirePermission()` instead of after them, so the member row is not a gate in front of
 * every screen's queries. It is not an authorisation decision: RLS still decides every row, and
 * the page still awaits `requireMember()` (which redirects a signed-out or inactive session)
 * before it renders anything the reads returned.
 */
export const getSessionUserId = cache(async (): Promise<string | null> => {
  const supabase = await createServerSupabase();
  const claims = await readClaims(supabase);
  return claims?.claims.sub ?? null;
});

/**
 * Runs a read keyed by the viewer's id without waiting for the member row:
 * `Promise.all([requireMember(), withSessionUserId(getOwnMember)])`. With no session it sends
 * the visitor to sign in, exactly as `requireMember()` would; an inactive member's session
 * still has an id, their reads come back empty under RLS, and `requireMember()` ends it.
 */
export async function withSessionUserId<T>(read: (id: string) => Promise<T>): Promise<T> {
  const id = await getSessionUserId();
  if (!id) redirect(LOGIN_PATH);
  return read(id);
}

/**
 * The verified claims, or `null` when there is no usable session. A transient failure at GoTrue
 * (unreachable, 5xx, timeout) must never read as "signed out", which would end the session on
 * the next hop: it throws `SessionUnavailableError`, whose digest the error boundary turns
 * into "You're still signed in, try again" (2.6, owner decision 2026-09-24). An expired or
 * refused session is `null`, as before.
 */
async function readClaims(supabase: Awaited<ReturnType<typeof createServerSupabase>>) {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error && classifySessionError(error) === "transient") {
      throw new SessionUnavailableError(error);
    }
    return data;
  } catch (error) {
    if (error instanceof SessionUnavailableError) throw error;
    throw new SessionUnavailableError(error);
  }
}

/** The signed-in active member, or `null`. The seam every page and guard uses. */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  const state = await getSessionState();
  return state.kind === "member" ? state.member : null;
}

/**
 * For layouts and pages that exist only for members (ADR-0011 rule 3: the decision lives
 * here, not inline). Signed out → `/login` (the proxy already adds `next=` for direct hits);
 * an inactive session is ended first so a deactivated person can't keep a live cookie.
 */
export async function requireMember(): Promise<CurrentMember> {
  const state = await getSessionState();
  if (state.kind === "member") return state.member;
  redirect(state.kind === "inactive" ? SIGN_OUT_INACTIVE_PATH : LOGIN_PATH);
}

/**
 * `/auth/signout` (GET, reached only through `requireMember()`): ends a session whose member
 * is not active and says why on /login. A session that turns out to be fine is not touched,
 * so a pasted link can't log anyone out. Returns where to send the browser.
 */
export async function endInactiveSession(): Promise<string> {
  const state = await getSessionState();
  if (state.kind === "member") return "/";
  if (state.kind === "inactive") {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    // `@supabase/ssr` clears the cookies only when GoTrue answered; on a 5xx they would keep
    // bouncing the visitor between /login and here, so clear them by hand.
    if (error) await clearAuthCookies();
    return `${LOGIN_PATH}?reason=inactive`;
  }
  return LOGIN_PATH;
}

async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith("sb-")) store.delete(cookie.name);
  }
}

/**
 * Sets the home hint the proxy reads to answer `/` (2.7, `home-hint.ts`). A route handler or a
 * server action only. Called at sign-in, set-password and with each Start day (3b.1).
 */
export async function setHomeHint(userId: string, role: MemberRole): Promise<void> {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  (await cookies()).set(HOME_HINT_COOKIE, formatHomeHint(userId, role), {
    httpOnly: true,
    sameSite: "lax",
    secure: appEnv === "staging" || appEnv === "production",
    path: "/",
    // Refreshed with each Start day; the Owner (who has no day) refreshes it at sign-in.
    maxAge: 60 * 60 * 24 * 30,
  });
}

export type { CurrentMember } from "./types";

/**
 * What the browser's Realtime client needs (5.1): the member's access token and the seconds it
 * has left by the server's clock (a phone's clock may be off).
 */
export type RealtimeAuth = { token: string; expiresIn: number | null };

/**
 * The session's access token for the browser's Realtime client (`createRealtimeSupabase`,
 * ARCHITECTURE §10): handed over as a prop because the cookies are `httpOnly` and stay so. Read
 * after `requireMember()` has verified the session (`getClaims()`), so this is the same session,
 * refreshed by the proxy when it was due. `expiresIn` counts from now (the JWT's `exp`): the page
 * asks for a new one when it lapses. `null` when there is none.
 */
export async function getRealtimeAuth(): Promise<RealtimeAuth | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  const expiresAt = session.expires_at ?? null;
  return {
    token: session.access_token,
    expiresIn: expiresAt === null ? null : expiresAt - Math.floor(systemClock().getTime() / 1000),
  };
}
