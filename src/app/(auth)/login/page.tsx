import type { Metadata } from "next";

// Imported from their own files, not the `components` barrel: the barrel also exports
// `LogoutProvider`, and a barrel of client components is not tree-shaken per route — every
// client component in it joins the route's bundle. That put sonner and radix-alert-dialog on
// the sign-in page (task 1.5).
import { FormAlert } from "@/core/auth/components/form-alert";
import { LoginForm } from "@/core/auth/components/login-form";
import { safeNextPath } from "@/core/auth/paths";

export const metadata: Metadata = { title: "Sign in" };

/** Why someone arrived here, when the app sent them (`?reason=`); anything else is ignored. */
const REASONS: Record<string, { tone: "info" | "danger"; text: string }> = {
  signed_out: { tone: "info", text: "You're logged out. The time was recorded." },
  inactive: { tone: "danger", text: "This account is not active. Ask the Owner." },
  link: { tone: "danger", text: "This link has expired or was already used. Ask for a new one." },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  const notice = reason && Object.hasOwn(REASONS, reason) ? REASONS[reason] : undefined;
  const safeNext = safeNextPath(next);

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Sign in</h1>
      <p className="text-muted-foreground mb-5 text-sm">
        MaxOff is invite-only. Use the email the Owner invited you with.
      </p>
      {notice ? (
        <div className="mb-4">
          <FormAlert tone={notice.tone}>{notice.text}</FormAlert>
        </div>
      ) : null}
      <LoginForm next={safeNext ?? undefined} />
    </>
  );
}
