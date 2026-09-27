import { formatIST } from "@/core/time";

import { safeFileName } from "./limits";

/**
 * Where an object lives: `<org>/<yyyy>/<mm>/<file id>/<name>`. The id keeps every key unique
 * and the date prefix keeps a bucket listing readable; the name is the last segment so a
 * console download keeps it. Pure, so it is unit-tested apart from the repository.
 */
export function storageKeyFor(orgId: string, fileId: string, name: string, at: Date): string {
  const month = formatIST(at, "yyyy/MM");
  return `${orgId}/${month}/${fileId}/${safeFileName(name)}`;
}
