/**
 * modules/privacy: the staff privacy notice (v7.5 Q1, owner 2026-11-26; docs/PRIVACY.md): its words
 * and version (`domain/notice.ts`), the member's own record of reading it, and "Got it". Shown at
 * Me → Privacy, with a one-time card at the end of the home screen until it is read. Client
 * components are not exported here: a route imports them one file at a time (ADR-0011 amendment).
 */
export {
  needsReading,
  PRIVACY_NOTICE_INTRO,
  PRIVACY_NOTICE_SECTIONS,
  PRIVACY_NOTICE_TITLE,
  PRIVACY_NOTICE_VERSION,
  PRIVACY_QUESTIONS_HEADING,
  PRIVACY_QUESTIONS_LINE,
  type NoticeSection,
  RETENTION,
} from "./domain/notice";
export { getOwnNoticeRead } from "./data/reads";
export { confirmPrivacyNoticeRead } from "./actions/notice";
export { PrivacyCard } from "./components/privacy-card";
export { PrivacyNotice } from "./components/privacy-notice";
export { PrivacyReminder } from "./components/privacy-reminder";
