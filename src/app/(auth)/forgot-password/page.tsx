import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/core/auth/components";

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
