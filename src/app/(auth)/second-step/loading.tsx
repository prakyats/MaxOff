import { SecondStepForm } from "@/core/auth/components/second-step-form";

import { SecondStepIntro } from "./intro";

/**
 * While the page reads the session's authenticators (v7.5 Q2): the code step, disabled, the one most
 * sign-ins see, so nothing moves when it arrives; screen readers hear "Loading".
 */
export default function Loading() {
  return (
    <div data-slot="second-step-loading" aria-busy="true">
      <span className="sr-only" role="status">
        Loading
      </span>
      <SecondStepIntro mode="verify" />
      <SecondStepForm mode="verify" placeholder />
    </div>
  );
}
