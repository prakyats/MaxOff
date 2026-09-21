import type { Metadata } from "next";

import { Forbidden } from "@/core/ui/composites/forbidden";

export const metadata: Metadata = { title: "No access" };

/**
 * 403. `requirePermission` (task 1.1) redirects here when a page's permission check fails;
 * pages can also render `<Forbidden />` inline.
 */
export default function ForbiddenPage() {
  return <Forbidden />;
}
