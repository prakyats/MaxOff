import { createServer, type IncomingMessage, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHoldProxy } from "../e2e/hold-proxy";

/**
 * The e2e server's Supabase proxy (`e2e/hold-proxy.ts`, 4C review M1) passes what it must not
 * touch and holds only what a test registers (owner requirement 2026-09-30: phase 5's Realtime
 * bell runs its e2e through it). Against a tiny upstream made here, so it runs in `pnpm check`
 * with no Supabase and no Docker: a WebSocket upgrade is tunnelled (the 101, bytes both ways, a
 * close on either side closes the other), a chunked answer streams chunk by chunk, a held path
 * waits for its release while an unheld one answers at once. No timers: every step waits for the
 * event it is about.
 */

let upstream: Server;
let proxy: Server;
let proxyPort: number;
/** Sends the streamed answer's second chunk and ends it (the test decides when). */
let finishStream: () => void = () => undefined;
/** Answers the upstream's `/slow` write (the test decides when); set once it has arrived. */
let finishSlow: (() => void) | null = null;
let onSlow: () => void = () => undefined;
/** The upstream's side of the latest tunnelled socket. */
let upstreamSocket: Promise<Duplex>;
let onUpstreamSocket: (socket: Duplex) => void = () => undefined;

function port(server: Server): number {
  return (server.address() as AddressInfo).port;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

/** A bearer token whose payload names a session (unsigned: the proxy only reads it). */
function tokenFor(session: string): string {
  const payload = Buffer.from(JSON.stringify({ session_id: session })).toString("base64url");
  return `header.${payload}.signature`;
}

/** A bearer token of a person (the JWT's `sub`). */
function tokenOf(member: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: member })).toString("base64url");
  return `header.${payload}.signature`;
}

/** One POST through the proxy as a person; resolves with its status once it ends. */
function postAs(path: string, member: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        path,
        method: "POST",
        headers: { authorization: `Bearer ${tokenOf(member)}` },
      },
      (answer) => {
        answer.resume();
        answer.on("end", () => resolve(answer.statusCode ?? 0));
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** Fences a person; resolves with the fence's status once the proxy answers it. */
function fence(member: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port: proxyPort, path: "/__fence", method: "POST" },
      (answer) => {
        answer.resume();
        answer.on("end", () => resolve(answer.statusCode ?? 0));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(JSON.stringify({ member }));
  });
}

function nextUpstreamSocket(): void {
  upstreamSocket = new Promise((resolve) => {
    onUpstreamSocket = resolve;
  });
}

/** One GET through the proxy; resolves with its status and body once it ends. */
function get(path: string, session?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        path,
        headers: session ? { authorization: `Bearer ${tokenFor(session)}` } : {},
      },
      (answer) => {
        let body = "";
        answer.setEncoding("utf8");
        answer.on("data", (chunk: string) => (body += chunk));
        answer.on("end", () => resolve({ status: answer.statusCode ?? 0, body }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

beforeAll(async () => {
  upstream = createServer((incoming: IncomingMessage, answer) => {
    if (incoming.url === "/stream") {
      answer.writeHead(200, { "content-type": "text/plain" });
      answer.write("first;");
      finishStream = () => answer.end("second");
      return;
    }
    if (incoming.url === "/slow") {
      incoming.resume();
      finishSlow = () => answer.writeHead(201).end();
      onSlow();
      return;
    }
    answer.writeHead(200, { "content-type": "text/plain" });
    answer.end(`read ${incoming.url ?? ""}`);
  });
  // A WebSocket-like upstream: answers 101 with the client's key echoed, then echoes every byte.
  upstream.on("upgrade", (incoming: IncomingMessage, socket: Duplex) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: echo-${String(incoming.headers["sec-websocket-key"])}\r\n` +
        `X-Seen-Protocol: ${String(incoming.headers["sec-websocket-protocol"])}\r\n\r\n`,
    );
    socket.on("data", (bytes: Buffer) => socket.write(bytes));
    socket.on("error", () => undefined);
    // As a WebSocket server does: the peer's end closes the connection.
    socket.on("end", () => socket.destroy());
    onUpstreamSocket(socket);
  });
  await listen(upstream);
  proxy = createHoldProxy(new URL(`http://127.0.0.1:${port(upstream)}`));
  await listen(proxy);
  proxyPort = port(proxy);
});

afterAll(async () => {
  proxy.closeAllConnections();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

/** Opens a WebSocket upgrade through the proxy; resolves with the 101 and the client socket. */
function upgrade(): Promise<{
  status: number;
  headers: IncomingMessage["headers"];
  socket: Duplex;
}> {
  nextUpstreamSocket();
  return new Promise((resolve, reject) => {
    const outgoing = request({
      host: "127.0.0.1",
      port: proxyPort,
      path: "/realtime/v1/websocket?vsn=1.0.0",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        "sec-websocket-protocol": "phoenix",
      },
    });
    outgoing.on("upgrade", (answer, socket) =>
      resolve({ status: answer.statusCode ?? 0, headers: answer.headers, socket }),
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** The next bytes a socket receives. */
function nextData(socket: Duplex): Promise<string> {
  return new Promise((resolve) =>
    socket.once("data", (bytes: Buffer) => resolve(bytes.toString())),
  );
}

function closed(socket: Duplex): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) resolve();
    else socket.once("close", () => resolve());
  });
}

describe("the hold proxy passes what it must not touch", () => {
  it("tunnels a WebSocket upgrade: the 101 with its headers, bytes both ways", async () => {
    const { status, headers, socket } = await upgrade();
    expect(status).toBe(101);
    expect(headers["sec-websocket-accept"]).toBe("echo-dGhlIHNhbXBsZSBub25jZQ==");
    expect(headers["x-seen-protocol"]).toBe("phoenix");
    const echoed = nextData(socket);
    socket.write("ping");
    expect(await echoed).toBe("ping");
    // The other way: bytes the upstream sends on its own reach the client.
    const pushed = nextData(socket);
    (await upstreamSocket).write("from upstream");
    expect(await pushed).toBe("from upstream");
    socket.destroy();
  });

  it("closes the upstream's side when the client closes, and the client's when the upstream does", async () => {
    const first = await upgrade();
    const firstUpstream = await upstreamSocket;
    first.socket.destroy();
    await closed(firstUpstream);

    const second = await upgrade();
    (await upstreamSocket).destroy();
    await closed(second.socket);
  });

  it("streams a chunked answer: the first chunk arrives before the upstream sends the second", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      const outgoing = request(
        { host: "127.0.0.1", port: proxyPort, path: "/stream" },
        (answer) => {
          let text = "";
          answer.setEncoding("utf8");
          answer.once("data", (chunk: string) => {
            text += chunk;
            expect(chunk).toBe("first;");
            // Only now does the upstream send the rest: a buffering proxy would never get here.
            answer.on("data", (more: string) => (text += more));
            finishStream();
          });
          answer.on("end", () => resolve(text));
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
    expect(body).toBe("first;second");
  });
});

describe("the hold proxy holds what a test registers, and only that", () => {
  it("holds a registered path for its session until the hold is released", async () => {
    const hold = request({
      host: "127.0.0.1",
      port: proxyPort,
      path: "/__hold",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const events: string[] = [];
    let onEvent: () => void = () => undefined;
    const holding = new Promise<void>((resolve, reject) => {
      hold.on("error", reject);
      hold.on("response", (answer) => {
        answer.setEncoding("utf8");
        answer.on("data", (chunk: string) => {
          events.push(...chunk.split("\n").filter(Boolean));
          onEvent();
        });
        onEvent = () => {
          if (events.length > 0) resolve();
        };
        onEvent();
      });
    });
    hold.on("error", () => undefined);
    hold.end(JSON.stringify({ path: "/rest/v1/task_types", session: "held-session" }));
    await holding;
    expect(events[0]).toBe('{"hold":1}');

    let answered = false;
    const caught = new Promise<void>((resolve) => {
      onEvent = () => {
        if (events.some((line) => line.includes('"caught"'))) resolve();
      };
    });
    const held = get("/rest/v1/task_types?select=id", "held-session").then((answer) => {
      answered = true;
      return answer;
    });
    await caught;

    // Meanwhile: another path of the same session, the same path of another session and a
    // request with no session all answer at once.
    expect(await get("/rest/v1/task_templates", "held-session")).toEqual({
      status: 200,
      body: "read /rest/v1/task_templates",
    });
    expect((await get("/rest/v1/task_types?select=id", "other-session")).status).toBe(200);
    expect((await get("/rest/v1/task_types?select=id")).status).toBe(200);
    expect(answered).toBe(false);

    hold.destroy();
    expect(await held).toEqual({ status: 200, body: "read /rest/v1/task_types?select=id" });
  });

  it("fences a person: answers once their write in flight ends, then refuses theirs only", async () => {
    const arrived = new Promise<void>((resolve) => {
      onSlow = resolve;
    });
    const write = postAs("/slow", "person-being-removed");
    await arrived;

    let fenceAnswered = false;
    const fenced = fence("person-being-removed").then((status) => {
      fenceAnswered = true;
      return status;
    });
    // While their write is still at the upstream, the fence waits; their next request is refused
    // and someone else's passes.
    expect(await postAs("/rest/v1/rpc/app_open_report", "person-being-removed")).toBe(403);
    expect(await postAs("/rest/v1/rpc/app_open_report", "someone-else")).toBe(200);
    expect(fenceAnswered).toBe(false);

    finishSlow?.();
    expect(await write).toBe(201);
    expect(await fenced).toBe(200);
    expect(await postAs("/rest/v1/rpc/app_open_report", "person-being-removed")).toBe(403);
    // A person with nothing in flight is fenced at once.
    expect(await fence("idle-person")).toBe(200);
  });

  it("answers its health check", async () => {
    expect(await get("/__hold/health")).toEqual({ status: 200, body: "ok" });
  });
});
