import type { Metadata } from "next";

import { getCurrentMember } from "@/core/auth/server";
import { blockedKeysFrom, blockedLine } from "@/core/permissions/blocked";
import { Forbidden } from "@/core/ui/composites/forbidden";
import { PageHeader } from "@/core/ui/composites/page-header";
import { homeFor } from "@/core/ui/shell/nav";

export const metadata: Metadata = { title: "No access" };

/** The home screens by address, as the button names them. */
const HOME_NAMES: Record<string, string> = { "/my-day": "My Day", "/today": "Today" };

/**
 * 403. `requirePermission` (task 1.1) redirects here when a page's permission check fails, with
 * the keys it asked for (`?for=`); pages can also render `<Forbidden />` inline. It keeps the
 * standard header, titled "No access" (PP-crew-3, V5b: on a phone the title bar, the MaxOff mark
 * and the bell stay), names what was blocked in one line ("Clients are for the Owner and Admins",
 * the approved pull-in sample, V5b-D; worked out from the permission table), and its button goes
 * back to the reader's home ("Back to My Day", "Back to Today"). The member comes from the
 * session the shell already read.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [member, { for: keys }] = await Promise.all([getCurrentMember(), searchParams]);
  const home = member ? homeFor(member.role) : "/";
  const name = HOME_NAMES[home];
  const where = name === "My Day" ? "Your tasks and calendar have" : "Your home screen has";
  return (
    <>
      <PageHeader title="No access" />
      <Forbidden
        homeHref={home}
        homeLabel={name ? `Back to ${name}` : "Go home"}
        title={blockedLine(blockedKeysFrom(keys))}
        message={
          member?.role === "owner"
            ? `${where} everything you need.`
            : `${where} everything you need. Ask the Owner if you think you should see this.`
        }
      />
    </>
  );
}
