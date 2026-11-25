import { type Mock, vi } from "vitest";

import type { UploadService } from "../data/service";

/**
 * Stand-ins for the upload link's tests: the service repository with every method a `vi.fn`
 * (each test scripts the answers it needs), a Supabase client that records RPCs and table reads,
 * and Google's resumable-session status endpoint.
 */
export type FakeService = { [K in keyof UploadService]: Mock<UploadService[K]> };

export function fakeService(
  overrides: Partial<Record<keyof UploadService, unknown>> = {},
): FakeService {
  const svc = {
    seal: vi.fn(async () => true),
    resolve: vi.fn(async () => null),
    register: vi.fn(async () => ({ uploader_id: "up-1" })),
    fileStart: vi.fn(async () => ({ result: "already_sent" })),
    folderPut: vi.fn(async (input: { driveFolderId: string }) => input.driveFolderId),
    sessionSet: vi.fn(async () => undefined),
    progress: vi.fn(async () => true),
    fileFailed: vi.fn(async () => undefined),
    fileDone: vi.fn(async () => "done"),
    saidDone: vi.fn(async () => undefined),
    rateHit: vi.fn(async () => null),
    rateBlocked: vi.fn(async () => false),
    fileRow: vi.fn(async () => null),
    ownFile: vi.fn(async () => null),
    uploaderOrg: vi.fn(async () => "org-1"),
    clientName: vi.fn(async () => "Acme"),
    watchDue: vi.fn(async () => []),
    recordOffset: vi.fn(async () => true),
    signals: vi.fn(async () => ({ stuck: 0, looks_finished: 0 })),
    dailyLimitHit: vi.fn(async () => new Date("2026-11-25T10:15:00Z")),
    driveCheckClaim: vi.fn(async () => []),
    driveSeen: vi.fn(async () => "missing_in_drive"),
    ...overrides,
  };
  return svc as unknown as FakeService;
}

export type RecordedCall = { kind: "rpc" | "from"; name: string; args: unknown[] };

/** A Supabase client that records every call and answers from `answer`. */
export function fakeSupabase(answer: (call: RecordedCall) => unknown = () => null) {
  const calls: RecordedCall[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      const call: RecordedCall = { kind: "rpc", name, args: [args] };
      calls.push(call);
      return { data: answer(call), error: null };
    },
    from(table: string) {
      const call: RecordedCall = { kind: "from", name: table, args: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const step of ["select", "eq", "gt", "in", "limit"]) {
        chain[step] = (...args: unknown[]) => {
          call.args.push([step, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({ data: answer(call), error: null });
      chain.then = (resolve: (value: unknown) => void) =>
        resolve({ data: answer(call) ?? [], error: null });
      return chain;
    },
  };
  return { client, calls };
}

/** Google's session endpoint: `incomplete` (308), `complete` (200 with the file) or `gone` (404). */
export function fakeSessionGoogle(
  answers: Record<string, { status: number; range?: string; body?: unknown }>,
) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    seen.push({ url: href, init });
    const next = answers[href];
    if (!next) throw new Error(`no scripted answer for ${href}`);
    const headers = new Headers(next.range ? { range: next.range } : {});
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers,
    });
  }) as typeof fetch;
  return { impl, seen };
}

export const KEY_BASE64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
/** A token-shaped string (43 base64url characters). */
export const TOKEN = "A".repeat(42) + "Q";
export const DEVICE_KEY = "b".repeat(42) + "A";
