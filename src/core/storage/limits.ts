/**
 * What may be uploaded, per purpose (kickoff 3 decisions 11-13, PRODUCT §4.4 / §4.16,
 * ARCHITECTURE §11). Client-safe: the picker checks these before a byte leaves the phone, and
 * the server checks them again in `beginUpload`. Submissions (photos ≤ 25 MB, video ≤ 100 MB)
 * join in phase 5 on the same table.
 */

export const FILE_PURPOSES = ["logo", "avatar", "preview"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export function isFilePurpose(value: unknown): value is FilePurpose {
  return typeof value === "string" && (FILE_PURPOSES as readonly string[]).includes(value);
}

const MB = 1024 * 1024;

export const MAX_BYTES: Record<FilePurpose, number> = {
  logo: 5 * MB,
  avatar: 5 * MB,
  /** A browser-made JPEG of at most 512px on its long edge is far under this. */
  preview: 1 * MB,
};

export const ALLOWED_MIMES: Record<FilePurpose, readonly string[]> = {
  logo: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  avatar: ["image/png", "image/jpeg", "image/webp"],
  preview: ["image/jpeg"],
};

/** The `accept` attribute for a picker of that purpose. */
export function acceptFor(purpose: FilePurpose): string {
  return ALLOWED_MIMES[purpose].join(",");
}

export const SVG_MIME = "image/svg+xml";

/** Raster images a browser renders straight from `/api/files/<id>`. */
export const RASTER_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export function isRasterMime(mime: string): boolean {
  return (RASTER_MIMES as readonly string[]).includes(mime);
}

/** The long edge and quality of the JPEG preview the browser makes (PRODUCT §4.9). */
export const PREVIEW_MAX_EDGE = 512;
export const PREVIEW_QUALITY = 0.82;

/** Parts of a multipart upload (ARCHITECTURE §11): S3 needs ≥ 5 MiB per part but the last. */
export const MULTIPART_PART_SIZE = 8 * MB;
/** Above this a file goes up in parts, each retried on its own. */
export const MULTIPART_THRESHOLD = 8 * MB;
export const PRESIGN_UPLOAD_SECONDS = 15 * 60;
export const PRESIGN_DOWNLOAD_SECONDS = 5 * 60;
/** How long a browser preview or thumbnail may be cached, privately: a file never changes. */
export const PREVIEW_CACHE_SECONDS = 24 * 60 * 60;
export const FILE_NAME_MAX = 255;

/** `storage_cleanup` (kickoff 3 decision 13): objects of rows archived this long ago, and of uploads still pending this long, are deleted. */
export const ARCHIVED_RETENTION_DAYS = 30;
export const PENDING_RETENTION_HOURS = 24;
/** …and of a ready original nothing references this long after upload (owner decision 2026-09-27, 3B review). */
export const ORPHANED_RETENTION_DAYS = 7;

export type CleanupThresholds = { archivedBefore: Date; pendingBefore: Date; orphanedBefore: Date };

export function cleanupThresholds(now: Date): CleanupThresholds {
  return {
    archivedBefore: new Date(now.getTime() - ARCHIVED_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    pendingBefore: new Date(now.getTime() - PENDING_RETENTION_HOURS * 60 * 60 * 1000),
    orphanedBefore: new Date(now.getTime() - ORPHANED_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${Number((bytes / MB).toFixed(1))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Why a file cannot be uploaded for this purpose, or null. The message is what the picker
 * shows; the server repeats the check and answers VALIDATION with the same text.
 */
export function checkFile(
  purpose: FilePurpose,
  file: { mime: string; size: number },
): string | null {
  if (!ALLOWED_MIMES[purpose].includes(file.mime)) {
    const kinds = ALLOWED_MIMES[purpose].map(mimeLabel).join(", ");
    return purpose === "avatar"
      ? `A photo is ${kinds}. SVG is not accepted for photos.`
      : `Use ${kinds}.`;
  }
  if (!(file.size > 0)) return "This file is empty.";
  if (file.size > MAX_BYTES[purpose]) {
    return `Keep it under ${formatBytes(MAX_BYTES[purpose])} (this one is ${formatBytes(file.size)}).`;
  }
  return null;
}

function mimeLabel(mime: string): string {
  switch (mime) {
    case "image/png":
      return "PNG";
    case "image/jpeg":
      return "JPEG";
    case "image/webp":
      return "WebP";
    case "image/svg+xml":
      return "SVG";
    default:
      return mime;
  }
}

/** The preview's size: the long edge fits `PREVIEW_MAX_EDGE`; a smaller image keeps its size. */
export function previewSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= PREVIEW_MAX_EDGE) return { width, height };
  const scale = PREVIEW_MAX_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** How many parts a size takes at `MULTIPART_PART_SIZE`. */
export function partCount(size: number): number {
  return Math.max(1, Math.ceil(size / MULTIPART_PART_SIZE));
}

/** The byte range of one part (1-based), for `Blob.slice`. */
export function partRange(size: number, partNumber: number): { start: number; end: number } {
  const start = (partNumber - 1) * MULTIPART_PART_SIZE;
  return { start, end: Math.min(size, start + MULTIPART_PART_SIZE) };
}

/**
 * A name safe for a key and a `Content-Disposition`: the last path segment, no control
 * characters, quotes or slashes, at most `FILE_NAME_MAX` characters, never empty.
 */
export function safeFileName(name: string, fallback = "file"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FILE_NAME_MAX);
  return cleaned || fallback;
}
