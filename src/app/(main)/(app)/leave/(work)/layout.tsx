import type { ReactNode } from "react";

import { PageHeader } from "@/core/ui/composites/page-header";

import { LeaveTabs, WORK_TABS } from "../leave-tabs";

const DESCRIPTION = "Note overtime and days off worked, and claim what you spent for work.";

/**
 * The member's extra work and expense claims (5B decision 3): two views, `/leave/extra-work`
 * (notes and comp leave, 3b.2) and `/leave/expenses` (claims, 3b.3), under one header and tab
 * bar; each view's primary action is its own (Add note, Add expense). The addresses stayed where
 * they were, so every notification, push and email already sent still opens them. A row on Me
 * leads here on a phone; the Crew's desktop sidebar has it (decision 5). Each page checks
 * `attendance.self` itself; this layout awaits nothing, so the header and tabs paint at once.
 */
export default function WorkLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Extra work & expenses" description={DESCRIPTION} help={DESCRIPTION} />
      <LeaveTabs tabs={WORK_TABS} label="Extra work and expenses" />
      {children}
    </>
  );
}
