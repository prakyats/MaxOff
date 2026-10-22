/**
 * core/storage: file storage (ARCHITECTURE §11, ADR-0010). This barrel is client-safe (the
 * limits and types); the adapter, the repository and the actions are `server-only`
 * (`@/core/storage/server`, `@/core/storage/actions`), the browser upload helper is
 * `@/core/storage/client/upload`, and the components are imported by file
 * (`components/image-upload-sheet`, `components/file-image`), never from a barrel (ADR-0011
 * amendment).
 */
export {
  acceptFor,
  ALLOWED_MIMES,
  checkFile,
  FILE_NAME_MAX,
  FILE_PURPOSES,
  formatBytes,
  isFilePurpose,
  isRasterMime,
  MAX_BYTES,
  MULTIPART_PART_SIZE,
  MULTIPART_THRESHOLD,
  partCount,
  partRange,
  PREVIEW_CACHE_SECONDS,
  PREVIEW_MAX_EDGE,
  PREVIEW_QUALITY,
  previewSize,
  safeFileName,
  SVG_MIME,
  type FilePurpose,
} from "./limits";
export type { BeginUploadResult, UploadPlan } from "./actions";

/**
 * The same-origin preview route (kickoff 3 decision 12): permission-checked, privately cached and
 * immutable (a file id never changes). `thumb` is a profile photo's 96 px list thumbnail (v1.8
 * V5b-D), the preview standing in for a photo uploaded before it.
 */
export function fileUrl(
  fileId: string,
  variant: "original" | "preview" | "thumb" = "preview",
): string {
  return variant === "original" ? `/api/files/${fileId}` : `/api/files/${fileId}?variant=${variant}`;
}
