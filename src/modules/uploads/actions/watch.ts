import "server-only";

import type { ServiceSupabase } from "@/core/db/service";
import { readDriveEnv } from "@/core/drive/env";
import { DriveApiError, type Fetch } from "@/core/drive/google";
import { sessionStatus } from "@/core/drive/resumable";
import { DriveUnavailableError, unsealSession } from "@/core/drive/upload-session";
import { captureException } from "@/core/observability/capture";
import { type Clock } from "@/core/time";

import { serviceClient, uploadService, type UploadService } from "../data/service";
import { hasSession, verifyFinished } from "./verify";

/**
 * `upload_watch` (v4.5, WORKFLOWS §8; plan F3): every minute, behind `/api/cron/upload-watch`.
 * For each uploading file whose page has been quiet for 2 minutes (`upload_watch_due`), the
 * Worker asks Google the session's offset itself and records it (`upload_record_offset`), so
 * "Stuck" is Google's number, not the browser's; a session Google says is complete is checked
 * and recorded as the page's "done" would be (`upload_file_done`), so a file that finished after
 * the page closed, or after the link stopped, is still received (`after_stop`). Then the signals
 * (`upload_signals`: stuck and looks finished, each once). Nothing while the Drive needs
 * reconnecting (the due list holds only connected organisations). Session addresses are never
 * logged; a failure on one file is counted and leaves the others alone.
 */
export type WatchReport = {
  due: number;
  offsets: number;
  received: number;
  failedChecks: number;
  gone: number;
  errors: number;
  signals: { stuck: number; looks_finished: number } | null;
};

export async function runUploadWatch(input: {
  svc: UploadService;
  service: ServiceSupabase;
  fetchImpl: Fetch;
  now: Date;
}): Promise<WatchReport> {
  const report: WatchReport = {
    due: 0,
    offsets: 0,
    received: 0,
    failedChecks: 0,
    gone: 0,
    errors: 0,
    signals: null,
  };
  if (readDriveEnv().mode === "on") {
    const due = await input.svc.watchDue(input.now);
    report.due = due.length;
    for (const row of due) {
      try {
        const status = await sessionStatus(input.fetchImpl, {
          sessionUrl: await unsealSession(row.session_uri_encrypted),
          size: Number(row.size_bytes),
        });
        if (status.state === "incomplete") {
          await input.svc.recordOffset(row.file_id, status.received, input.now);
          report.offsets += 1;
          continue;
        }
        if (status.state === "gone") {
          // Google forgot the session (a week, or a refusal): the row is marked checked, and
          // "Stuck" tells the Admin once 15 minutes pass with nothing new.
          await input.svc.recordOffset(row.file_id, Number(row.bytes_at_google), input.now);
          report.gone += 1;
          continue;
        }
        const file = await input.svc.fileRow(row.file_id);
        if (!file || !hasSession(file)) continue;
        const verdict = await verifyFinished({
          svc: input.svc,
          service: input.service,
          file,
          localMd5: null,
          browserDriveFileId: null,
          status,
          fetchImpl: input.fetchImpl,
          now: input.now,
        });
        if (verdict.outcome === "done") report.received += 1;
        if (verdict.outcome === "failed") report.failedChecks += 1;
      } catch (error) {
        // Google busy or down, or the Drive needs reconnecting: tried again next minute. Anything
        // else is reported (scrubbed) and leaves the other files alone.
        report.errors += 1;
        if (!(error instanceof DriveApiError) && !(error instanceof DriveUnavailableError)) {
          captureException(error);
        }
      }
    }
  }
  report.signals = await input.svc.signals(input.now);
  return report;
}

export function uploadWatchJob(clock: Clock): Promise<WatchReport> {
  const service = serviceClient();
  return runUploadWatch({ svc: uploadService(service), service, fetchImpl: fetch, now: clock() });
}
