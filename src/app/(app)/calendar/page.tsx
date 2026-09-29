import { CalendarDaysIcon } from "lucide-react";
import type { Metadata } from "next";

import { PlaceholderPage } from "../_placeholder/placeholder-page";
import { STAND_INS } from "../_placeholder/stand-ins";

export const metadata: Metadata = { title: "Calendar" };

/** The calendar (task 6.4): until then a stand-in, the same for every role. */
export default function CalendarPage() {
  return <PlaceholderPage title="Calendar" copy={STAND_INS.calendar} icon={CalendarDaysIcon} />;
}
