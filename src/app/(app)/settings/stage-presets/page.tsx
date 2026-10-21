import { redirect } from "next/navigation";

/**
 * The old Settings → Stage presets path (7.4). Stage presets are the first section of the one
 * Templates page (6b.6 owner note, 2026-10-16), so this path redirects there, replacing the entry
 * (no extra history), and `#presets` opens that section.
 */
export default function StagePresetsPage(): never {
  redirect("/settings/templates#presets");
}
