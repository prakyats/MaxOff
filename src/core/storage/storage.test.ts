import { afterEach, describe, expect, it, vi } from "vitest";

import { attachmentDisposition, createS3Adapter, encodeKey } from "./adapter";
import { parseStorageEnv } from "./env";
import { storageKeyFor } from "./keys";
import {
  ARCHIVED_RETENTION_DAYS,
  checkFile,
  cleanupThresholds,
  MAX_BYTES,
  MULTIPART_PART_SIZE,
  partCount,
  partRange,
  PENDING_RETENTION_HOURS,
  previewSize,
  safeFileName,
} from "./limits";
import { sanitiseSvg, SvgSanitiseError } from "./svg";

const ENV = parseStorageEnv({
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "maxoff",
  S3_ACCESS_KEY_ID: "maxoff",
  S3_SECRET_ACCESS_KEY: "maxoff-local-secret",
  S3_REGION: "auto",
});

describe("limits (kickoff 3: logos ≤ 5 MB PNG/JPEG/WebP/SVG, avatars no SVG)", () => {
  it("accepts a logo of an allowed type under the size", () => {
    expect(checkFile("logo", { mime: "image/svg+xml", size: 1024 })).toBeNull();
    expect(checkFile("avatar", { mime: "image/webp", size: MAX_BYTES.avatar })).toBeNull();
  });

  it("refuses an SVG photo, a wrong type, an empty or an oversized file, with the shown text", () => {
    expect(checkFile("avatar", { mime: "image/svg+xml", size: 10 })).toContain(
      "SVG is not accepted",
    );
    expect(checkFile("logo", { mime: "application/pdf", size: 10 })).toContain(
      "Use PNG, JPEG, WebP, SVG",
    );
    expect(checkFile("logo", { mime: "image/png", size: 0 })).toBe("This file is empty.");
    expect(checkFile("logo", { mime: "image/png", size: MAX_BYTES.logo + 1 })).toContain(
      "Keep it under 5 MB",
    );
    expect(checkFile("preview", { mime: "image/png", size: 10 })).toContain("Use JPEG");
  });

  it("plans parts of MULTIPART_PART_SIZE, the last one shorter", () => {
    expect(partCount(1)).toBe(1);
    expect(partCount(MULTIPART_PART_SIZE)).toBe(1);
    expect(partCount(MULTIPART_PART_SIZE * 2 + 1)).toBe(3);
    expect(partRange(MULTIPART_PART_SIZE * 2 + 5, 3)).toEqual({
      start: MULTIPART_PART_SIZE * 2,
      end: MULTIPART_PART_SIZE * 2 + 5,
    });
  });

  it("fits a preview inside 512px on its long edge and leaves a small image alone", () => {
    expect(previewSize(2048, 1024)).toEqual({ width: 512, height: 256 });
    expect(previewSize(300, 700)).toEqual({ width: 219, height: 512 });
    expect(previewSize(100, 80)).toEqual({ width: 100, height: 80 });
  });

  it("makes a file name safe for a key and a header", () => {
    expect(safeFileName('C:\\photos\\me "1".jpg')).toBe("me 1.jpg");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("x".repeat(300))).toHaveLength(255);
  });
});

describe("env", () => {
  it("reads the five names, defaults the region and the public endpoint, trims slashes", () => {
    expect(
      parseStorageEnv({
        S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com/",
        S3_BUCKET: "maxoff-staging",
        S3_ACCESS_KEY_ID: "k",
        S3_SECRET_ACCESS_KEY: "s",
      }),
    ).toEqual({
      endpoint: "https://abc.r2.cloudflarestorage.com",
      publicEndpoint: "https://abc.r2.cloudflarestorage.com",
      bucket: "maxoff-staging",
      accessKeyId: "k",
      secretAccessKey: "s",
      region: "auto",
    });
  });

  it("names every problem at once", () => {
    expect(() => parseStorageEnv({ S3_BUCKET: "Bad Name" })).toThrow(
      /S3_ENDPOINT must be an http\(s\) URL; .*S3_BUCKET must be a bucket name; S3_ACCESS_KEY_ID is missing; S3_SECRET_ACCESS_KEY is missing/,
    );
  });
});

describe("keys and URLs", () => {
  it("lays a key out as org/yyyy/mm/id/name, in IST", () => {
    expect(
      storageKeyFor("org1", "file1", "Logo (final).png", new Date("2026-09-30T20:30:00Z")),
    ).toBe("org1/2026/10/file1/Logo (final).png");
  });

  it("encodes each key segment and keeps the slashes", () => {
    expect(encodeKey("org/2026/09/id/Logo (final)+x.png")).toBe(
      "org/2026/09/id/Logo%20%28final%29%2Bx.png",
    );
  });

  it("builds an attachment disposition with a UTF-8 name and an ASCII fallback", () => {
    expect(attachmentDisposition('résumé "v2".pdf')).toBe(
      `attachment; filename="r_sum_ v2.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`,
    );
  });
});

describe("S3 adapter (aws4fetch over path-style URLs)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("presigns a PUT on the public endpoint with an expiry in the query", async () => {
    const adapter = createS3Adapter({ ...ENV, publicEndpoint: "http://localhost:9000" });
    const url = new URL(await adapter.presignPut("org/2026/09/f/a b.png", { expiresIn: 900 }));
    expect(url.origin).toBe("http://localhost:9000");
    expect(url.pathname).toBe("/maxoff/org/2026/09/f/a%20b.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(
      /^maxoff\/\d{8}\/auto\/s3\/aws4_request$/,
    );
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("presigns a download as an attachment", async () => {
    const adapter = createS3Adapter(ENV);
    const url = new URL(
      await adapter.presignGet("k/logo.png", { expiresIn: 300, downloadName: "logo.png" }),
    );
    expect(url.searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="logo.png"; filename*=UTF-8''logo.png`,
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("runs a multipart upload through the REST calls, in part order", async () => {
    const calls: { method: string; url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({ method: request.method, url: request.url, body: await request.text() });
        if (request.url.includes("?uploads")) {
          return new Response(
            "<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>",
            { status: 200 },
          );
        }
        return new Response("<CompleteMultipartUploadResult/>", { status: 200 });
      }),
    );
    const adapter = createS3Adapter(ENV);
    expect(await adapter.createMultipart("k/big.mp4", "video/mp4")).toBe("up-1");
    const part = new URL(await adapter.presignPart("k/big.mp4", "up-1", 2, { expiresIn: 60 }));
    expect(part.searchParams.get("partNumber")).toBe("2");
    expect(part.searchParams.get("uploadId")).toBe("up-1");
    await adapter.completeMultipart("k/big.mp4", "up-1", [
      { partNumber: 2, etag: '"b"' },
      { partNumber: 1, etag: '"a"' },
    ]);
    expect(calls.map((c) => c.method)).toEqual(["POST", "POST"]);
    expect(calls[1]?.url).toContain("?uploadId=up-1");
    expect(calls[1]?.body).toBe(
      "<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;a&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;b&quot;</ETag></Part></CompleteMultipartUpload>",
    );
  });

  it("treats a missing object as null on HEAD and as done on DELETE, and reports other errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.method === "HEAD") return new Response(null, { status: 404 });
        if (request.method === "DELETE") return new Response(null, { status: 404 });
        return new Response("<Error><Message>nope</Message></Error>", { status: 403 });
      }),
    );
    const adapter = createS3Adapter(ENV);
    expect(await adapter.head("k/x")).toBeNull();
    await expect(adapter.delete("k/x")).resolves.toBeUndefined();
    await expect(adapter.put("k/x", new Uint8Array([1]), "image/png")).rejects.toThrow(
      /PutObject failed \(403\)/,
    );
  });
});

describe("sanitiseSvg (kickoff 3: an SVG logo is rewritten from an allow-list)", () => {
  it("keeps shapes, gradients and internal references", () => {
    const out = sanitiseSvg(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><use href="#r"/></svg>`,
    );
    expect(out).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('<use href="#r"');
  });

  it("drops scripts, handlers, foreign objects, external references and dangerous styles", () => {
    const out = sanitiseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><image href="https://evil/x.png"/><a href="javascript:alert(1)"><circle r="1" onclick="x()" style="fill:url(https://evil/a)"/></a><use xlink:href="https://evil#x"/><rect style="fill:red" width="1" height="1"/><path d="M0 0" fill="url(#ok)"/></svg>`,
    );
    expect(out).not.toContain("script");
    expect(out).not.toContain("onload");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("foreignObject");
    expect(out).not.toContain("<image");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("evil");
    expect(out).toContain('<rect style="fill:red" width="1" height="1"/>');
    expect(out).toContain('fill="url(#ok)"');
    expect(out).toContain("<use/>");
  });

  it("refuses what is not an SVG document", () => {
    expect(() => sanitiseSvg("<html><body>hi</body></html>")).toThrow(SvgSanitiseError);
    expect(() => sanitiseSvg("<svg><unclosed")).toThrow(SvgSanitiseError);
    expect(() => sanitiseSvg("not xml at all")).toThrow(SvgSanitiseError);
  });

  it("strips a DOCTYPE and its entities", () => {
    const out = sanitiseSvg(
      `<!DOCTYPE svg [<!ENTITY x "1">]><svg xmlns="http://www.w3.org/2000/svg"><title>&x;</title></svg>`,
    );
    expect(out).not.toContain("DOCTYPE");
    expect(out).toContain("<title>");
  });
});

describe("cleanup thresholds (WORKFLOWS §4a Files)", () => {
  it("looks 30 days back for archived rows and 24 hours for pending ones", () => {
    const now = new Date("2026-09-27T21:30:00Z");
    const { archivedBefore, pendingBefore } = cleanupThresholds(now);
    expect(ARCHIVED_RETENTION_DAYS).toBe(30);
    expect(PENDING_RETENTION_HOURS).toBe(24);
    expect(archivedBefore.toISOString()).toBe("2026-08-28T21:30:00.000Z");
    expect(pendingBefore.toISOString()).toBe("2026-09-26T21:30:00.000Z");
  });
});
