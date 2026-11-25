/** Set password's heading and line, shared by the page and its loading screen. */
export function SetPasswordIntro() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Set your password</h1>
      <p className="text-muted-foreground mb-5 text-sm">
        Choose the password you&apos;ll sign in with from now on.
      </p>
    </>
  );
}
