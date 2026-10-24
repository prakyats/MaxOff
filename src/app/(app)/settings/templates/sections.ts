/**
 * The one Templates page's sections (6b.6 owner note, 2026-10-16), in build order, shared by the
 * page and its loading screen: the heading a laptop shows and the phone's segment label.
 */
export type TemplateSectionKey = "presets" | "deliverables" | "projects" | "tasks";

export const TEMPLATE_SECTIONS: readonly { key: TemplateSectionKey; tab: string }[] = [
  { key: "presets", tab: "Presets" },
  { key: "deliverables", tab: "Deliverables" },
  { key: "projects", tab: "Projects" },
  { key: "tasks", tab: "Tasks" },
];

/**
 * The phone's segmented control track: four segments in a row, each as wide as its name needs
 * and sharing what is left, so "Deliverables" reads whole at 375 px (the design gate, 23 Oct:
 * equal columns cut it to "Deliverabl…"); at large system text they wrap to two rows instead of
 * cutting the names short.
 */
export const TEMPLATE_TABS_CLASS = "bg-muted rounded-control flex flex-wrap gap-1 p-1 md:hidden";

/** One segment of that track: grows from its name's width (the skeleton's segments too). */
export const TEMPLATE_TAB_ITEM_CLASS = "min-h-11 min-w-0 flex-[1_1_auto]";
