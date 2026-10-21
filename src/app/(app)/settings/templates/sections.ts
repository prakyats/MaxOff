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
