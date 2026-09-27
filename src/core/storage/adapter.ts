import { AwsClient } from "aws4fetch";

import type { StorageEnv } from "./env";

/**
 * The one door to the bucket (ARCHITECTURE §11). S3-compatible: R2 in deployed environments,
 * MinIO locally and in e2e, both through path-style URLs and SigV4 (`aws4fetch`, chosen over
 * the AWS SDK because it is a few kilobytes on top of `fetch`, runs unchanged on Workers and
 * signs presigned URLs and multipart calls alike). Keys are opaque here; `server.ts` decides
 * their layout. Nothing in this file knows about rows or permissions.
 */
export interface StorageObject {
  size: number;
  contentType: string;
  etag: string | null;
}

export interface StorageAdapter {
  /** A URL the browser PUTs the whole object to. */
  presignPut(key: string, options: { expiresIn: number }): Promise<string>;
  /** Starts a multipart upload; the parts are PUT to `presignPart` URLs, then `completeMultipart`. */
  createMultipart(key: string, contentType: string): Promise<string>;
  presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    options: { expiresIn: number },
  ): Promise<string>;
  completeMultipart(
    key: string,
    uploadId: string,
    parts: readonly { partNumber: number; etag: string }[],
  ): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** A short-lived GET, as an attachment when a file name is given. */
  presignGet(key: string, options: { expiresIn: number; downloadName?: string }): Promise<string>;
  head(key: string): Promise<StorageObject | null>;
  /** The object's bytes as a stream, with its metadata; null when it does not exist. */
  get(key: string): Promise<(StorageObject & { body: ReadableStream<Uint8Array> }) | null>;
  /** A server-side write (a sanitised SVG goes back this way). */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Removes the object; an object that is already gone is fine. */
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${operation} failed (${status}): ${detail}`);
    this.name = "StorageError";
  }
}

/**
 * Every path segment percent-encoded, slashes kept: the key is a path under the bucket. An empty,
 * `.` or `..` segment is refused: a URL would collapse it and reach another object's key.
 */
export function encodeKey(key: string): string {
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new StorageError("EncodeKey", 0, "A storage key has an empty or dot segment.");
  }
  return segments
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/** An RFC 5987 `Content-Disposition` for a download, with an ASCII fallback for old clients. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function parseXmlTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match?.[1] ?? null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** aws4fetch calls the global `fetch`; tests stub it (`vi.stubGlobal`). */
export function createS3Adapter(env: StorageEnv): StorageAdapter {
  const aws = new AwsClient({
    accessKeyId: env.accessKeyId,
    secretAccessKey: env.secretAccessKey,
    service: "s3",
    region: env.region,
    // The adapter retries nothing: the browser retries a part, the cron retries a run.
    retries: 0,
  });

  const objectUrl = (key: string, base = env.endpoint, query = "") =>
    `${base}/${env.bucket}/${encodeKey(key)}${query}`;

  async function presign(url: string, method: "GET" | "PUT", expiresIn: number): Promise<string> {
    const withExpiry = `${url}${url.includes("?") ? "&" : "?"}X-Amz-Expires=${expiresIn}`;
    const signed = await aws.sign(withExpiry, { method, aws: { signQuery: true } });
    return signed.url;
  }

  async function call(operation: string, url: string, init: RequestInit): Promise<Response> {
    const response = await aws.fetch(url, init);
    if (!response.ok) {
      throw new StorageError(operation, response.status, (await response.text()).slice(0, 300));
    }
    return response;
  }

  return {
    presignPut(key, { expiresIn }) {
      return presign(objectUrl(key, env.publicEndpoint), "PUT", expiresIn);
    },

    async createMultipart(key, contentType) {
      const response = await call(
        "CreateMultipartUpload",
        objectUrl(key, env.endpoint, "?uploads"),
        {
          method: "POST",
          headers: { "content-type": contentType },
        },
      );
      const uploadId = parseXmlTag(await response.text(), "UploadId");
      if (!uploadId)
        throw new StorageError("CreateMultipartUpload", 200, "no UploadId in the answer");
      return uploadId;
    },

    presignPart(key, uploadId, partNumber, { expiresIn }) {
      return presign(
        objectUrl(
          key,
          env.publicEndpoint,
          `?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`,
        ),
        "PUT",
        expiresIn,
      );
    },

    async completeMultipart(key, uploadId, parts) {
      const body = `<CompleteMultipartUpload>${[...parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map(
          (part) =>
            `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`,
        )
        .join("")}</CompleteMultipartUpload>`;
      const response = await call(
        "CompleteMultipartUpload",
        objectUrl(key, env.endpoint, `?uploadId=${encodeURIComponent(uploadId)}`),
        { method: "POST", headers: { "content-type": "application/xml" }, body },
      );
      // S3 answers 200 and puts an error in the body when the assembly fails.
      const text = await response.text();
      if (text.includes("<Error>")) {
        throw new StorageError(
          "CompleteMultipartUpload",
          200,
          parseXmlTag(text, "Message") ?? text.slice(0, 300),
        );
      }
    },

    async abortMultipart(key, uploadId) {
      const response = await aws.fetch(
        objectUrl(key, env.endpoint, `?uploadId=${encodeURIComponent(uploadId)}`),
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 404) {
        throw new StorageError(
          "AbortMultipartUpload",
          response.status,
          (await response.text()).slice(0, 300),
        );
      }
    },

    presignGet(key, { expiresIn, downloadName }) {
      const query = downloadName
        ? `?response-content-disposition=${encodeURIComponent(attachmentDisposition(downloadName))}`
        : "";
      return presign(objectUrl(key, env.publicEndpoint, query), "GET", expiresIn);
    },

    async head(key) {
      const response = await aws.fetch(objectUrl(key), { method: "HEAD" });
      if (response.status === 404) return null;
      if (!response.ok) throw new StorageError("HeadObject", response.status, "");
      return {
        size: Number(response.headers.get("content-length") ?? "0"),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        etag: response.headers.get("etag"),
      };
    },

    async get(key) {
      const response = await aws.fetch(objectUrl(key), { method: "GET" });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok || !response.body) {
        throw new StorageError("GetObject", response.status, (await response.text()).slice(0, 300));
      }
      return {
        size: Number(response.headers.get("content-length") ?? "0"),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        etag: response.headers.get("etag"),
        body: response.body,
      };
    },

    async put(key, body, contentType) {
      await call("PutObject", objectUrl(key), {
        method: "PUT",
        headers: { "content-type": contentType, "content-length": String(body.byteLength) },
        // A copy onto a plain ArrayBuffer: a Uint8Array over a shared buffer is not a BodyInit.
        body: body.slice().buffer,
      });
    },

    async delete(key) {
      const response = await aws.fetch(objectUrl(key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new StorageError(
          "DeleteObject",
          response.status,
          (await response.text()).slice(0, 300),
        );
      }
    },
  };
}
