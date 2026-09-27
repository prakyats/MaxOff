import { createServiceSupabase, type ServiceSupabase } from "@/core/db/service";

import { type StorageAdapter, StorageError } from "./adapter";
import { cleanupThresholds } from "./limits";
import { type FileRecord, getStorageAdapter, toFileRecord } from "./server";

/**
 * `storage_cleanup` (WORKFLOWS §8, kickoff 3 decision 13): deletes the objects of rows archived
 * **30 days** ago, of rows still `pending` (or `failed`) after **24 hours**, and of `ready`
 * originals nothing references after **7 days** with their previews (owner decision 2026-09-27,
 * 3B review; the database decides what "references" means), and marks each `deleted`. The
 * row stays (invariant 9). Idempotent: a deleted row is never a candidate again, an object that
 * is already gone counts as deleted, and a failure on one object leaves the others alone and is
 * reported. Runs with the service client from the cron route, in batches until nothing is left.
 */
const BATCH = 200;
const MAX_BATCHES = 50;

export type CleanupReport = {
  examined: number;
  deleted: number;
  failed: { fileId: string; error: string }[];
};

export async function runStorageCleanup({
  service,
  storage,
  now,
}: {
  service: ServiceSupabase;
  storage: StorageAdapter;
  now: Date;
}): Promise<CleanupReport> {
  const { archivedBefore, pendingBefore, orphanedBefore } = cleanupThresholds(now);
  const report: CleanupReport = { examined: 0, deleted: 0, failed: [] };
  const seen = new Set<string>();

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { data, error } = await service.rpc("file_cleanup_candidates", {
      archived_before: archivedBefore.toISOString(),
      pending_before: pendingBefore.toISOString(),
      orphaned_before: orphanedBefore.toISOString(),
      batch: BATCH,
    });
    if (error) throw error;
    // A row that failed stays a candidate; stop once a batch brings nothing new.
    const candidates: FileRecord[] = data.map(toFileRecord).filter((file) => !seen.has(file.id));
    if (candidates.length === 0) break;

    for (const file of candidates) {
      seen.add(file.id);
      report.examined += 1;
      try {
        await storage.delete(file.storageKey);
        const { error: markError } = await service.rpc("file_mark_deleted", { file_id: file.id });
        if (markError) throw markError;
        report.deleted += 1;
      } catch (error) {
        report.failed.push({
          fileId: file.id,
          error:
            error instanceof StorageError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error),
        });
      }
    }
    if (candidates.length < BATCH) break;
  }
  return report;
}

/** The job as the cron route runs it: the service client (no user) and the app's adapter. */
export function storageCleanupJob(now: Date): Promise<CleanupReport> {
  return runStorageCleanup({ service: createServiceSupabase(), storage: getStorageAdapter(), now });
}
