/**
 * The second step's heading and its one line (v7.5 Q2), shared by the page and its loading screen so
 * nothing moves when the page arrives.
 */
export function SecondStepIntro({ mode }: { mode: "verify" | "setup" }) {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">
        {mode === "setup" ? "Set up two-step sign-in" : "Enter your code"}
      </h1>
      <p className="text-muted-foreground mb-5 text-sm">
        {mode === "setup"
          ? "Your account signs in with your password and a code from an authenticator app on your phone. Set it up once; each sign-in then asks for the newest code."
          : "Open your authenticator app and enter the 6-digit code it shows for MaxOff."}
      </p>
    </>
  );
}
