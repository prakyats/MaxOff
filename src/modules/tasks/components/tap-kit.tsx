"use client";

/**
 * What the app's tap drawings need from tasks (`app/(app)/tap-drawings/`, v7.0): the skeletons
 * the task page's and the Tasks tab's loading screens are made of, client-side in one file
 * (ADR-0011 amendment), the same components those loading screens render on the server.
 */
export { TaskPageSkeleton } from "./task-page-skeleton";
export { TaskRowsSkeleton, TaskSectionHeadingSkeleton } from "./task-row-skeleton";
