import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { AppError } from "@/core/errors";
import type { ISODate } from "@/core/time";

import { type EodReport, parseEodReport } from "../domain/eod";

/**
 * The end-of-day report's reads (6.5): the saved rows under RLS (`reports.all`: the Owner) and the
 * live view through `eod_report_preview()`, which the database refuses to anyone else. The job
 * alone writes; nothing here does.
 */

export type SavedEodReport = { id: string; date: ISODate; generatedAt: string; report: EodReport };

/** A date's saved report, or null when the job has not written it (or the viewer may not read it). */
export async function getEodReport(date: ISODate): Promise<SavedEodReport | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("eod_reports")
    .select("id, report_date, generated_at, data")
    .eq("report_date", date)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const report = parseEodReport(data.data);
  if (!report) {
    throw new AppError("INTERNAL", undefined, {
      cause: new Error(`eod_reports ${data.id}: the data is not a report`),
    });
  }
  return { id: data.id, date: data.report_date as ISODate, generatedAt: data.generated_at, report };
}

/** The saved reports, newest first, a page at a time (the history under Reports → End of day). */
export async function listEodReports(
  page: number,
  size: number,
): Promise<{ rows: { id: string; date: ISODate; generatedAt: string }[]; total: number }> {
  const supabase = await createServerSupabase();
  const from = (page - 1) * size;
  const { data, error, count } = await supabase
    .from("eod_reports")
    .select("id, report_date, generated_at", { count: "exact" })
    .order("report_date", { ascending: false })
    .range(from, from + size - 1);
  if (error) throw error;
  return {
    rows: data.map((row) => ({
      id: row.id,
      date: row.report_date as ISODate,
      generatedAt: row.generated_at,
    })),
    total: count ?? data.length,
  };
}

/**
 * A day's report computed now (`eod_report_preview()`): today so far, or yesterday until the
 * End-day cutoff. The database refuses anyone but the Owner (FORBIDDEN) and a future date.
 */
export async function previewEodReport(date: ISODate): Promise<EodReport> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("eod_report_preview", { p_date: date });
  if (error) throw error;
  const report = parseEodReport(data);
  if (!report) {
    throw new AppError("INTERNAL", undefined, {
      cause: new Error("eod_report_preview: the payload is not a report"),
    });
  }
  return report;
}
