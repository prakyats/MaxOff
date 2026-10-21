import { redirect } from "next/navigation";

import { assertClientId } from "../client";

/**
 * The old client Activity tab's path (3.4). The history is the header's History sheet since the
 * v1.8 consistency sweep (owner 2026-10-21), so this path redirects to the client's Overview with
 * that sheet open (`?history=1`, which the sheet drops from the address by replace), replacing the
 * entry: no extra history.
 */
export default async function ClientActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  assertClientId(id);
  redirect(`/clients/${id}?history=1`);
}
