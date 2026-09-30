/**
 * The bucket the app talks to (ARCHITECTURE §11): MinIO locally and in every e2e run, R2 on
 * staging and production, through the same five S3_* names (`.env.example` says where each
 * comes from). Read at first use, validated by hand like `core/db/env.ts` (two rules, no zod).
 */
export interface StorageEnv {
  /** The S3 API endpoint the server signs and calls, e.g. `http://127.0.0.1:9000`. */
  endpoint: string;
  /** The endpoint the browser uploads to; defaults to `endpoint`. */
  publicEndpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export function parseStorageEnv(raw: Record<string, string | undefined>): StorageEnv {
  const endpoint = raw.S3_ENDPOINT?.trim() ?? "";
  const bucket = raw.S3_BUCKET?.trim() ?? "";
  const accessKeyId = raw.S3_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = raw.S3_SECRET_ACCESS_KEY?.trim() ?? "";
  const region = raw.S3_REGION?.trim() || "auto";
  const publicEndpoint = raw.S3_PUBLIC_ENDPOINT?.trim() || endpoint;

  const problems: string[] = [];
  if (!isHttpUrl(endpoint)) problems.push("S3_ENDPOINT must be an http(s) URL");
  if (!isHttpUrl(publicEndpoint)) problems.push("S3_PUBLIC_ENDPOINT must be an http(s) URL");
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) problems.push("S3_BUCKET must be a bucket name");
  if (!accessKeyId) problems.push("S3_ACCESS_KEY_ID is missing");
  if (!secretAccessKey) problems.push("S3_SECRET_ACCESS_KEY is missing");
  if (problems.length > 0) {
    throw new Error(`File storage is not configured: ${problems.join("; ")}. See .env.example.`);
  }
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    publicEndpoint: publicEndpoint.replace(/\/+$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function storageEnv(): StorageEnv {
  return parseStorageEnv(process.env);
}
