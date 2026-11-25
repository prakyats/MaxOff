/**
 * The upload link (v4.5, ADR-0010 amendment 2026-11-19, DATA-MODEL §8a, WORKFLOWS §5B): the
 * platform-free rules (the link token, the uploader's name, the Admin's signals, the public API's
 * shapes), the member actions and reads, the upload page's public API (`/api/upload/*`) and the
 * every-minute watch (`/api/cron/upload-watch`), and the Uploads card's words (`domain/card-view`).
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment).
 */
export {
  deriveLinkToken,
  deviceKeyHash,
  isDeviceKeyShaped,
  isTokenShaped,
  linkKeyBytes,
  newLinkSalt,
  rateKeyHash,
  tokenFromBody,
  withoutToken,
  tokenHash,
  uploadLinkUrl,
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
export {
  BAD_LINK_MESSAGE,
  type DoneAnswer,
  type DoneBody,
  type FailedAnswer,
  type FailedBody,
  type FailedReason,
  type ProgressAnswer,
  type ProgressBody,
  type RegisterAnswer,
  type RegisterBody,
  type ResolveAnswer,
  type ResolveBody,
  type SaidDoneAnswer,
  type SaidDoneBody,
  type StartAnswer,
  type StartBody,
  UPLOAD_API_MAX_BODY_BYTES,
  type UploaderOwnFile,
  type WaitReason,
} from "./domain/api";
export type {
  DriveState,
  StopReason,
  UploadCard,
  UploadCardLink,
  UploadCardState,
  UploadCardUploader,
  UploaderSheet,
  UploaderSheetFile,
} from "./domain/card";
export { canMakeLink, cardShown } from "./domain/card-view";
export { uploaderContact } from "./domain/contact";
// The card's server-drawn first paint (no hooks, not a client component; the live card is
// `components/uploads-card-lazy`).
export { UploadsCardBody } from "./components/uploads-card-body";
export {
  type CardRead,
  readUploadCard,
  readUploadCardForPage,
  readUploaderSheet,
} from "./data/links";
export { LINK_KEY_OFF_MESSAGE, readLinkKey } from "./data/link-key";
export {
  copyUploadLink,
  eraseUploaderNetwork,
  getUploadLink,
  markFilesReceived,
  renewUploadLink,
  stopUploadLink,
  type UploadLinkAnswer,
} from "./actions/links";
export {
  checkUploaderFilesInDrive,
  readUploadCardFor,
  readUploaderSheetFor,
} from "./actions/background";
export {
  handleUploadApi,
  UPLOAD_API_HEADERS,
  uploadApiPost,
  type UploadEndpoint,
} from "./actions/public-api";
export { runUploadWatch, uploadWatchJob, type WatchReport } from "./actions/watch";
