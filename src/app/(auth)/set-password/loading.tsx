// Direct, not via the barrel: see the note in login/page.tsx.
import { SetPasswordForm } from "@/core/auth/components/set-password-form";

import { SetPasswordIntro } from "./intro";

/**
 * Opened from an email link, this page first reads the session the link opened (v7.5 plan §5.1,
 * G4: it used to stay blank meanwhile). The same heading and the same form, disabled, so nothing
 * moves when it is ready; screen readers hear "Loading".
 */
export default function Loading() {
  return (
    <div data-slot="set-password-loading" aria-busy="true">
      <span className="sr-only" role="status">
        Loading
      </span>
      <SetPasswordIntro />
      <SetPasswordForm placeholder />
    </div>
  );
}
