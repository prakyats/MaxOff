import type { Metadata } from "next";

import { readEmailEnv } from "@/core/notifications/email-env";
import { uploaderContact } from "@/modules/uploads";
import { UploadPage } from "@/modules/uploads/components/upload-page";

/**
 * `/upload#<token>` (v4.5, WORKFLOWS §5B.2): the uploader's page. Public, no session (the proxy
 * passes it straight through); the token stays in the fragment and the page's script sends it in
 * a header (plan A8). The server knows nothing about the link here: it renders the same page for
 * every visitor, and the browser asks `/api/upload/resolve`.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Send files" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function UploadRoute() {
  return <UploadPage contact={uploaderContact(readEmailEnv().from)} />;
}
