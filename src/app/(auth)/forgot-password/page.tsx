import type { Metadata } from "next";

// Direct, not via the barrel: see the note in login/page.tsx.
import { ForgotPasswordForm } from "@/core/auth/components/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Forgot your password?</h1>
      <p className="text-muted-foreground mb-5 text-sm">
        Enter your email and we&apos;ll send a link to set a new one.
      </p>
      <ForgotPasswordForm />
    </>
  );
}
