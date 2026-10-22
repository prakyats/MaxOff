import type { Metadata } from "next";

import { getCurrentMember } from "@/core/auth/server";
import { Forbidden } from "@/core/ui/composites/forbidden";
import { PageHeader } from "@/core/ui/composites/page-header";
import { homeFor } from "@/core/ui/shell/nav";

export const metadata: Metadata = { title: "No access" };

/** The home screens by address, as the button names them. */
const HOME_NAMES: Record<string, string> = { "/my-day": "My Day", "/today": "Today" };

/**
 * 403. `requirePermission` (task 1.1) redirects here when a page's permission check fails;
 * pages can also render `<Forbidden />` inline. It keeps the standard header, titled "No access"
 * (PP-crew-3, V5b: on a phone the title bar, the MaxOff mark and the bell stay), names what was
 * blocked, and its button goes back to the reader's home ("Back to My Day", "Back to Today").
 * The member comes from the session the shell already read.
 */
export default async function ForbiddenPage() {
  const member = await getCurrentMember();
  const home = member ? homeFor(member.role) : "/";
  const name = HOME_NAMES[home];
  return (
    <>
      <PageHeader title="No access" />
      <Forbidden
        homeHref={home}
        homeLabel={name ? `Back to ${name}` : "Go home"}
        message="This page is for another role, so it isn't open to you. Everything you need is on your home screen."
      />
    </>
  );
}
