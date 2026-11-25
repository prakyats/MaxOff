/**
 * modules/handin: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * v5.0 "Hand in work" (WORKFLOWS §5C, DATA-MODEL §8b, PROPOSED): the files the people on a task
 * add to the version the next Mark done hands in, each sent straight to the studio's Google
 * Drive (ADR-0010 amendment 2026-11-25). Client components are imported one file at a time
 * from `components/` (ADR-0011 amendment).
 */
export {
  cleanFileName,
  cleanRelativePath,
  isRiskyName,
  openVersion,
  sameFileKey,
  typeLabel,
  versionFolderName,
} from "./domain/files";
export type { FileState, LocalState, Progress, StatusTone } from "./domain/summary";
export {
  formatSize,
  handInTag,
  markDoneBlock,
  progressLines,
  statusOf,
  versionSummary,
} from "./domain/summary";
export {
  failHandinFile,
  finishHandinFile,
  readHandinVersions,
  reportHandinProgress,
  startHandinFile,
} from "./actions/background";
export type { HandinFile, HandinRead, HandinVersion, StartAnswer } from "./data/handin";
export { readHandin } from "./data/handin";
