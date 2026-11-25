/**
 * The upload link (v4.5, ADR-0010 amendment 2026-11-19, DATA-MODEL §8a, WORKFLOWS §5B). So far
 * the platform-free rules only: the link token, the uploader's name, and the Admin's signals.
 * The tables, functions, screens and the Google session follow per the docs.
 */
export {
  deriveLinkToken,
  isTokenShaped,
  linkKeyBytes,
  newLinkSalt,
  tokenHash,
} from "./domain/token";
export {
  cleanUploaderName,
  matchAssignee,
  NAME_MAX,
  type NameCheck,
  nameKey,
  uploaderFolderName,
} from "./domain/names";
export {
  LOOKS_FINISHED_AFTER_MS,
  STUCK_AFTER_MS,
  type UploaderActivity,
  type UploaderSignal,
  type UploadFileState,
  uploaderSignal,
} from "./domain/signals";
