import { getOwnNoticeRead } from "../data/reads";
import { needsReading } from "../domain/notice";
import { PrivacyCard } from "./privacy-card";

/**
 * The home screen's one-time card, when the member has not read this version of the notice (v7.5
 * Q1). Placed **last** on the screen inside its own `<Suspense fallback={null}>`: its read starts
 * with the render and never holds the page's first answer, and when it arrives there is nothing
 * below it to move. A failed read shows nothing (the notice is always at Me → Privacy).
 */
export async function PrivacyReminder() {
  const read = await getOwnNoticeRead().catch(() => undefined);
  if (read === undefined || !needsReading(read?.version ?? null)) return null;
  return <PrivacyCard />;
}
