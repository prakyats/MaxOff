import type { Metadata } from "next";
import { redirect } from "next/navigation";

// Direct, not via the barrel: see the note in login/page.tsx.
import { ContinueForm } from "@/core/auth/components/continue-form";
import { parseAuthLinkParams } from "@/core/auth/link-params";
import { EXPIRED_LINK_PATH } from "@/core/auth/links";

export const metadata: Metadata = {
  title: "Continue to MaxOff",
  // A one-time link is nobody's to list; the header from next.config.ts says the same.
  robots: { index: false, follow: false },
};

// The token is read from the URL on every request; nothing here is ever prerendered.
export const dynamic = "force-dynamic";

/**
 * Where every auth link lands (ADR-0012; the 3cB review): `/auth/confirm?token_hash=…&type=…`,
 * the same URL the recovery email, the invite link and the bootstrap script have always built.
 * The GET verifies **nothing**: it shows the link and one button. A chat drawing a link preview
 * while the message is typed, or a mail scanner, fetches this page and spends nothing; the POST
 * behind "Continue to MaxOff" (`confirmAuthLink`) is what verifies the one-time token and opens
 * the session. A link with no usable token goes to sign in with the reason, as it always did.
 */
export default async function ConfirmLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string | string[]; type?: string | string[] }>;
}) {
  const { token_hash, type } = await searchParams;
  const link = parseAuthLinkParams({ tokenHash: token_hash, type });
  if (!link) redirect(EXPIRED_LINK_PATH);

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Continue to MaxOff</h1>
      <p className="text-muted-foreground mb-5 text-sm">
        This link sets your MaxOff password. It works once, and only when you tap Continue.
      </p>
      <ContinueForm tokenHash={link.tokenHash} type={link.type} />
    </>
  );
}
