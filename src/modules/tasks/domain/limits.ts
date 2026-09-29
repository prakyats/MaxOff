/**
 * The sizes the database checks on a task (DATA-MODEL §6, 4A), zod-free so a form sets its
 * `maxLength` without bundling the schemas (task 2.8).
 */
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 10_000;
export const LOCATION_MAX = 300;
export const PURPOSE_MAX = 1000;
export const STAGE_NAME_MAX = 120;
/** A checklist this long is a project, not a task. */
export const STAGES_MAX = 30;
/** The Done note (kickoff 4 decision 10) and a comment. */
export const NOTE_MAX = 5000;
export const COMMENT_MAX = 5000;
/** A late reason, a review's reason, a cancel or reopen reason. */
export const REASON_MAX = 1000;
/** Kickoff 4 decision 4: picking a date sets the deadline's time to 6:00 PM IST. */
export const DEFAULT_DUE_TIME = "18:00";
/** Nobody assigns a task to more people than this. */
export const ASSIGNEES_MAX = 20;
