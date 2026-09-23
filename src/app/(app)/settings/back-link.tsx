import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";

/** The way back from a Settings section to the control centre (PRODUCT §4.16). */
export function SettingsBackLink() {
  return (
    <Link
      href="/settings"
      data-slot="settings-back"
      className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
    >
      <ChevronLeftIcon className="size-4" aria-hidden />
      Settings
    </Link>
  );
}
