"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { buttonVariants } from "@/core/ui/primitives/button-variants";
import { toastResult } from "@/core/ui/toast";

import { SECOND_STEP_PATH } from "../paths";
import { turnOffSecondStep } from "../second-step-actions";

/**
 * Me → "Two-step sign-in" (v7.5 Q2), for the Owner and Admins. Off: "Turn on" sets the
 * authenticator up (`/second-step?setup=1`). On: "Turn off" (an Admin; the Owner only where this
 * environment does not require it). Required for the Owner: says so, with no control.
 */
export function SecondStepSwitch({ on, required }: { on: boolean; required: boolean }) {
  const router = useRouter();
  const action = useAction(async () => {
    const result = await turnOffSecondStep();
    if (toastResult(result, { success: "Two-step sign-in is off" })) router.refresh();
  });
  const status = required ? "On · required for the Owner" : on ? "On" : "Off";
  return (
    <div data-slot="me-second-step" className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-[1_1_10rem]">
        <p className="text-sm font-medium">
          Two-step sign-in
          <span className="text-muted-foreground font-normal" data-slot="me-second-step-status">
            {" · "}
            {status}
          </span>
        </p>
        <p className="text-muted-foreground text-sm">
          A code from an authenticator app on your phone, after your password.
        </p>
      </div>
      {required ? null : on ? (
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="secondary"
            pending={action.pending}
            pendingLabel="Turning off…"
            data-slot="me-second-step-off"
            onClick={() => action.run()}
          >
            Turn off
          </Button>
          <ActionStatus action={action} />
        </div>
      ) : (
        <Link
          href={`${SECOND_STEP_PATH}?setup=1`}
          data-slot="me-second-step-on"
          className={buttonVariants({ variant: "secondary" })}
        >
          Turn on
        </Link>
      )}
    </div>
  );
}
