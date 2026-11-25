/**
 * A fake Google for the upload flows (v4.5, security plan §7.3): the e2e server's Google calls come
 * here when `GOOGLE_API_ORIGIN_FOR_TESTS` names it (`src/core/drive/endpoints.ts`, a local run's
 * only), and so do the browser's resumable PUTs (the session address it hands out is its own). It
 * keeps everything in memory and answers as Google does, as far as MaxOff reads the answers:
 *
 * - `POST /token`: an access token for any refresh token.
 * - `GET /drive/v3/about`: a 2 TB Drive, half used.
 * - `POST /drive/v3/files` (a folder), `PATCH /drive/v3/files/:id`, `GET /drive/v3/files/:id`:
 *   folders and files by id; a removed id is 404, a trashed one says so.
 * - `POST /upload/drive/v3/files?uploadType=resumable`: a session on this server (Location).
 * - `PUT` on a session: `Content-Range: bytes a-b/total` appends only at the current offset (308 with
 *   `Range` until complete, then 200 with id, size and md5Checksum); `bytes *\/total` asks where it
 *   stands. CORS lets the page read `Range` and the final answer.
 *
 * `/__fake/*` lets a spec look and steer: `state` (bytes received per session, and the bytes sent
 * twice), `remove/:id`, `trash/:id`, `daily-limit/on|off` (the next session opens are refused as
 * Google's daily upload limit), `drop/:n` (the next n chunk PUTs fail mid-file), `reset`.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Session = {
  id: string;
  name: string;
  parents: string[];
  size: number;
  bytes: Buffer[];
  received: number;
  twice: number;
  fileId: string | null;
};
type DriveFile = {
  id: string;
  name: string;
  size: number;
  md5: string;
  parents: string[];
  trashed: boolean;
};

// `node e2e/fake-google.ts` with FAKE_GOOGLE_PORT (playwright.config.ts passes it).
const port = Number(process.env.FAKE_GOOGLE_PORT);
if (!port) throw new Error("fake-google: FAKE_GOOGLE_PORT is needed");
const base = `http://127.0.0.1:${port}`;
let sessions = new Map<string, Session>();
let files = new Map<string, DriveFile>();
let removed = new Set<string>();
let dailyLimit = false;
let drops = 0;

function cors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, content-range, authorization, x-upload-content-type, x-upload-content-length",
  );
  res.setHeader("Access-Control-Expose-Headers", "Range, Location");
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function finish(session: Session): DriveFile {
  const all = Buffer.concat(session.bytes);
  const file: DriveFile = {
    id: `fake-${session.id.slice(0, 12)}`,
    name: session.name,
    size: all.length,
    md5: createHash("md5").update(all).digest("hex"),
    parents: session.parents,
    trashed: false,
  };
  files.set(file.id, file);
  session.fileId = file.id;
  return file;
}

const server = createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url ?? "/", base);
  const path = url.pathname;
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  // --- the spec's controls ------------------------------------------------------------------
  if (path === "/__fake/health") return json(res, 200, { ok: true });
  if (path === "/__fake/reset") {
    sessions = new Map();
    files = new Map();
    removed = new Set();
    dailyLimit = false;
    drops = 0;
    return json(res, 200, { ok: true });
  }
  if (path === "/__fake/state") {
    return json(res, 200, {
      sessions: [...sessions.values()].map((s) => ({
        name: s.name,
        size: s.size,
        received: s.received,
        twice: s.twice,
        done: s.fileId !== null,
      })),
      files: [...files.values()].map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        trashed: f.trashed,
      })),
    });
  }
  const control = /^\/__fake\/(remove|trash|daily-limit|drop)\/(.+)$/.exec(path);
  if (control) {
    const [, what, arg] = control;
    if (what === "remove") removed.add(arg!);
    if (what === "trash") {
      const file = files.get(arg!);
      if (file) file.trashed = true;
    }
    if (what === "daily-limit") dailyLimit = arg === "on";
    if (what === "drop") drops = Number(arg);
    return json(res, 200, { ok: true });
  }

  // --- OAuth -----------------------------------------------------------------------------------
  if (path === "/token" && req.method === "POST") {
    await body(req);
    return json(res, 200, {
      access_token: `fake-access-${randomUUID()}`,
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/drive.file",
    });
  }
  if (path === "/revoke") return json(res, 200, {});

  // --- Drive ------------------------------------------------------------------------------------
  if (path === "/drive/v3/about") {
    return json(res, 200, {
      user: { emailAddress: "test-drive@example.com", permissionId: "fake-account" },
      storageQuota: { limit: "2000000000000", usage: "1000000000000" },
    });
  }
  if (path === "/drive/v3/files" && req.method === "POST") {
    const meta = JSON.parse((await body(req)).toString() || "{}") as {
      name?: string;
      parents?: string[];
    };
    const file: DriveFile = {
      id: `folder-${randomUUID().slice(0, 12)}`,
      name: meta.name ?? "",
      size: 0,
      md5: "",
      parents: meta.parents ?? [],
      trashed: false,
    };
    files.set(file.id, file);
    return json(res, 200, { id: file.id });
  }
  const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
  if (one) {
    const id = decodeURIComponent(one[1]!);
    if (req.method === "PATCH") {
      await body(req);
      return json(res, 200, { id });
    }
    const file = files.get(id);
    if (!file || removed.has(id))
      return json(res, 404, { error: { code: 404, message: "File not found" } });
    return json(res, 200, {
      id,
      size: String(file.size),
      md5Checksum: file.md5,
      parents: file.parents,
      trashed: file.trashed,
    });
  }

  // --- resumable uploads ----------------------------------------------------------------------
  if (path === "/upload/drive/v3/files" && req.method === "POST") {
    const meta = JSON.parse((await body(req)).toString() || "{}") as {
      name?: string;
      parents?: string[];
    };
    if (dailyLimit) {
      return json(res, 403, {
        error: {
          code: 403,
          message: "The user has exceeded their Drive upload limit (uploadLimitExceeded)",
        },
      });
    }
    const session: Session = {
      id: randomUUID(),
      name: meta.name ?? "",
      parents: meta.parents ?? [],
      size: Number(req.headers["x-upload-content-length"] ?? 0),
      bytes: [],
      received: 0,
      twice: 0,
      fileId: null,
    };
    sessions.set(session.id, session);
    res.writeHead(200, {
      Location: `${base}/upload/drive/v3/files?uploadType=resumable&upload_id=${session.id}`,
    });
    return void res.end();
  }
  if (path === "/upload/drive/v3/files" && req.method === "PUT") {
    const session = sessions.get(url.searchParams.get("upload_id") ?? "");
    if (!session) return json(res, 404, { error: { code: 404, message: "Session gone" } });
    const range = String(req.headers["content-range"] ?? "");
    const chunk = await body(req);
    const answerStatus = () => {
      if (session.fileId) {
        const file = files.get(session.fileId)!;
        return json(res, 200, { id: file.id, size: String(file.size), md5Checksum: file.md5 });
      }
      if (session.received === 0) return void res.writeHead(308).end();
      res.writeHead(308, { Range: `bytes=0-${session.received - 1}` });
      return void res.end();
    };
    if (range.startsWith("bytes */")) return answerStatus();
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!match) return json(res, 400, { error: { message: "bad Content-Range" } });
    if (drops > 0) {
      drops -= 1;
      // A connection lost mid-file: the bytes never arrive.
      return void req.socket.destroy();
    }
    const start = Number(match[1]);
    if (start < session.received) session.twice += session.received - start;
    if (start === session.received) {
      session.bytes.push(chunk);
      session.received += chunk.length;
    }
    if (session.received >= session.size && !session.fileId) finish(session);
    return answerStatus();
  }

  return json(res, 404, { error: { message: `fake Google has no ${req.method} ${path}` } });
});

server.listen(port, "127.0.0.1");
