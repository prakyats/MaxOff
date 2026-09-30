/**
 * The e2e server's Supabase, through a pass-through proxy that a test can hold (4C review M1).
 *
 * Why: a route's loading screen is only sent when its page is slower than the shell. A page whose
 * reads answer before React flushes the shell streams no loading screen at all, so a check that
 * holds the **document** (the old `heldShell`, which cut the streamed HTML after the loading
 * screen) raced the page and lost now and then (the Owner's /tasks/all, an Admin's /today). This
 * holds the page's **data** instead: while a hold is on, the page cannot answer, React flushes the
 * shell with the loading screen, and the screen stays up until the test releases it.
 *
 * **What passes untouched** (everything but a held read): every HTTP request and its answer, piped
 * both ways as the bytes arrive, so a streamed or chunked answer reaches the caller chunk by chunk
 * and is never buffered; and every **WebSocket upgrade** (Supabase Realtime,
 * `/realtime/v1/websocket`), tunnelled byte for byte in both directions: the request's headers as
 * sent (`Sec-WebSocket-*` included, only `Host` rewritten to the upstream's), the upstream's `101`
 * relayed, both sockets piped and closed together, an error on either side closing the other. An
 * upgrade is never held.
 *
 * **What can be held:** a PostgREST read whose path a test registered (`/rest/v1/task_types`) and
 * whose bearer token belongs to the registered browser session (the JWT's `session_id`; the test
 * signs its page in with a session of its own, `ownSession()`): it waits, unforwarded, until the
 * hold ends. A test registers a hold with `POST /__hold` `{ path, session }` and keeps that request
 * open (`holdReads()` in `e2e/helpers.ts`): the answer streams one JSON line when the hold is on
 * (`{"hold":1}`) and one per request it catches (`{"caught":"/rest/v1/task_types"}`), and **the
 * hold lasts as long as the connection**: the test ends it by closing it, and a test that dies
 * ends it too, so a hold never outlives its test and nothing here waits on a clock. Other
 * sessions (every other test, the same person's included), other paths and the layout's own reads
 * pass, so the shell always streams and no other test ever waits. `GET /__hold/health` answers
 * once it listens.
 *
 * **Proved** by `tests/hold-proxy.test.ts` (Vitest, in `pnpm check`, against a tiny local
 * upstream): an upgrade's 101 and its bytes both ways and the close of either side, a chunked
 * answer's first chunk before the upstream sends its second, a held path held and released, an
 * unheld one answered at once.
 *
 * **Phase 5 (5A) must**, once the bell lands on Realtime: add an e2e check that a Realtime
 * subscription connects through this proxy, and start Realtime in CI's e2e job (remove `realtime`
 * from its `pnpm supabase start -x …` list in `.github/workflows/ci.yml`; CI runs no Realtime
 * today, so no e2e can check it there yet).
 *
 * Started by Playwright as the first `webServer` (`playwright.config.ts`), before the app, on
 * `HOLD_PROXY_PORT` in front of `HOLD_PROXY_UPSTREAM`: `node e2e/hold-proxy.ts` (Node strips the
 * types). `createHoldProxy()` is the same server, unstarted, for the test.
 */
import {
  Agent,
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  request as httpRequest,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";

type Hold = { path: string; session: string; report: (line: object) => void };
type Waiting = { path: string; session: string | null; forward: () => void };

/** Headers that belong to one connection, never passed on over HTTP. */
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-connection", "te", "trailer", "upgrade"];

function passable(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const copy = { ...headers };
  for (const name of HOP_BY_HOP) delete copy[name];
  return copy;
}

/** The session of a bearer JWT (unverified: the proxy only sorts requests, it decides nothing). */
function sessionOf(authorization: string | undefined): string | null {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      session_id?: unknown;
    };
    return typeof claims.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}

/** The proxy in front of `upstream` (an `http://host:port` origin), not yet listening. */
export function createHoldProxy(upstream: URL): Server {
  const agent = new Agent({ keepAlive: true, maxSockets: 256 });
  const holds = new Set<Hold>();
  let waiting: Waiting[] = [];

  const holdsFor = (path: string, session: string | null): Hold[] =>
    [...holds].filter((hold) => hold.path === path && hold.session === session);

  function forward(request: IncomingMessage, response: ServerResponse): void {
    const outgoing = httpRequest(
      {
        host: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        headers: { ...passable(request.headers), host: upstream.host },
        agent,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, passable(answer.headers));
        // Piped as it arrives: a streamed answer reaches the caller chunk by chunk.
        answer.pipe(response);
      },
    );
    outgoing.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    // A caller that goes away mid-request (a page closed at a test's end) ends its upstream
    // request too; neither side's error may take the proxy down.
    request.on("error", () => outgoing.destroy());
    response.on("error", () => outgoing.destroy());
    request.pipe(outgoing);
  }

  /** A hold ended: whatever waits and no remaining hold covers goes on. */
  function releaseWaiting(): void {
    const still: Waiting[] = [];
    for (const entry of waiting) {
      if (holdsFor(entry.path, entry.session).length > 0) still.push(entry);
      else entry.forward();
    }
    waiting = still;
  }

  function register(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      let body: { path?: unknown; session?: unknown } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as typeof body;
      } catch {
        // Answered below as a refusal.
      }
      if (typeof body.path !== "string" || typeof body.session !== "string") {
        response.writeHead(400).end("path and session are needed");
        return;
      }
      response.writeHead(200, {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
      });
      const hold: Hold = {
        path: body.path,
        session: body.session,
        report: (line) => response.write(`${JSON.stringify(line)}\n`),
      };
      response.on("error", () => undefined);
      holds.add(hold);
      // The hold is this connection: closing it (the test's release, or the test dying) ends it.
      response.on("close", () => {
        holds.delete(hold);
        releaseWaiting();
      });
      hold.report({ hold: holds.size });
    });
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://hold-proxy");
    if (url.pathname === "/__hold/health") {
      response.writeHead(200).end("ok");
      return;
    }
    if (url.pathname === "/__hold" && request.method === "POST") {
      register(request, response);
      return;
    }
    const session = sessionOf(request.headers.authorization);
    const holding = holdsFor(url.pathname, session);
    if (holding.length === 0) {
      forward(request, response);
      return;
    }
    for (const hold of holding) hold.report({ caught: url.pathname });
    const entry: Waiting = {
      path: url.pathname,
      session,
      forward: () => forward(request, response),
    };
    waiting.push(entry);
    // A request whose caller gave up is dropped, not forwarded later.
    response.on("close", () => {
      waiting = waiting.filter((other) => other !== entry);
    });
  });

  // WebSocket upgrades (Realtime): a byte-for-byte tunnel, never held.
  server.on("upgrade", (request: IncomingMessage, client: Duplex, head: Buffer) => {
    const target = connect(Number(upstream.port), upstream.hostname);
    const closeBoth = () => {
      client.destroy();
      target.destroy();
    };
    // Closed together: an HTTP server's sockets stay half-open after the peer's FIN, so the end
    // of either side (not only its close or an error) closes both.
    for (const socket of [client, target]) {
      socket.on("error", closeBoth);
      socket.on("end", closeBoth);
      socket.on("close", closeBoth);
    }
    target.on("connect", () => {
      const lines = [
        `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}`,
      ];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index] ?? "";
        const value = request.rawHeaders[index + 1] ?? "";
        lines.push(`${name}: ${name.toLowerCase() === "host" ? upstream.host : value}`);
      }
      target.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) target.write(head);
      // The upstream's 101 and every frame after it, and the client's frames, as they come.
      target.pipe(client);
      client.pipe(target);
    });
  });

  return server;
}

// `node e2e/hold-proxy.ts`: listen on HOLD_PROXY_PORT in front of HOLD_PROXY_UPSTREAM.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.HOLD_PROXY_PORT);
  const upstream = process.env.HOLD_PROXY_UPSTREAM;
  if (!Number.isInteger(port) || port <= 0 || !upstream) {
    throw new Error("hold-proxy: HOLD_PROXY_PORT and HOLD_PROXY_UPSTREAM are needed");
  }
  createHoldProxy(new URL(upstream)).listen(port, "127.0.0.1");
}
