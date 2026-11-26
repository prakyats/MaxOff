"use client";

import { useActionState, useState } from "react";

import type { Result } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { logout } from "../actions";
import { startSecondStepSetup, verifySecondStep } from "../second-step-actions";

import { FormAlert } from "./form-alert";

type Setup = { qrCode: string; secret: string };

/**
 * The second step of a sign-in (v7.5 Q2). `verify`: the 6-digit code from the authenticator app.
 * `setup`: first "Set up the app" (a new factor: its QR code to scan, and the key to type when the
 * camera can't), then the same code field. On success the action goes on to `next` or home, so the
 * form only ever renders a failure. One column, 16px inputs, 44px targets. `placeholder` draws it
 * disabled for the loading screen, so nothing moves when the page arrives.
 */
export function SecondStepForm({
  mode,
  next,
  placeholder = false,
}: {
  mode: "verify" | "setup";
  next?: string | undefined;
  placeholder?: boolean;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<never> | null, formData: FormData) =>
      verifySecondStep({ code: String(formData.get("code") ?? ""), ...(next ? { next } : {}) }),
    null,
  );
  const error = state && !state.ok ? state.error : null;

  if (mode === "setup" && !setup) {
    return (
      <div className="flex flex-col gap-4" data-slot="second-step-start">
        {setupError ? <FormAlert>{setupError}</FormAlert> : null}
        <Button
          variant="primary"
          type="button"
          className="w-full"
          disabled={placeholder}
          pending={starting}
          pendingLabel="Setting up…"
          data-slot="second-step-setup"
          onClick={async () => {
            setStarting(true);
            setSetupError(null);
            const result = await startSecondStepSetup();
            setStarting(false);
            if (result.ok) setSetup(result.data);
            else setSetupError(result.error.message);
          }}
        >
          Set up the authenticator app
        </Button>
        <SignOutInstead disabled={placeholder} />
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {setup ? (
        <div className="flex flex-col gap-3" data-slot="second-step-qr">
          <p className="text-sm">
            In your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…),
            add an account and scan this code.
          </p>
          {/* A data: URL the app's CSP allows (img-src data:); GoTrue draws it as an SVG. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing to optimise */}
          <img
            src={setup.qrCode}
            alt="QR code for your authenticator app"
            width={176}
            height={176}
            className="bg-qr-surface rounded-md p-2"
          />
          <p className="text-muted-foreground text-sm">
            Can&apos;t scan it? Type this key instead:{" "}
            <code data-slot="second-step-secret" className="text-foreground font-mono break-all">
              {setup.secret}
            </code>
          </p>
        </div>
      ) : null}
      {error && !error.fieldErrors ? <FormAlert>{error.message}</FormAlert> : null}
      <FormField label="6-digit code" error={error?.fieldErrors?.code}>
        {(control) => (
          <Input
            {...control}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={7}
            required
            autoFocus={!placeholder}
            disabled={placeholder}
            data-slot="second-step-code"
          />
        )}
      </FormField>
      <Button
        variant="primary"
        type="submit"
        className="w-full"
        disabled={placeholder}
        pending={pending}
        pendingLabel="Checking…"
        data-slot="second-step-continue"
      >
        Continue
      </Button>
      <SignOutInstead disabled={placeholder} />
    </form>
  );
}

/** Not now, or not this account: signs out of this device (no confirmation: nothing is lost). */
function SignOutInstead({ disabled }: { disabled: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full"
      disabled={disabled}
      data-slot="second-step-sign-out"
      onClick={() => void logout()}
    >
      Sign out
    </Button>
  );
}
