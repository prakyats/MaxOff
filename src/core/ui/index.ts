/**
 * Design system entry point (ARCHITECTURE §3 `core/ui`).
 *   primitives/  shadcn/ui components, added with `pnpm dlx shadcn add <name>` (see components.json)
 *   composites/  MaxOff building blocks every module screen uses
 *   shell/       the signed-in app chrome and role navigation
 *   theme/       light / dark
 * Primitives are imported by path (`@/core/ui/primitives/button`) so tree-shaking stays simple;
 * everything MaxOff-specific is exported here.
 */
export { BulkBar } from "./composites/bulk-bar";
export { ConfirmDialog } from "./composites/confirm-dialog";
export {
  DataTable,
  type DataTableProps,
  type MobileCard,
  selectionColumn,
} from "./composites/data-table";
export { HelpSheet } from "./composites/help-sheet";
export { EmptyRow, EmptyState } from "./composites/empty-state";
export { ErrorState } from "./composites/error-state";
export { Forbidden } from "./composites/forbidden";
export { LoadingState, PageLoading, type LoadingShape } from "./composites/loading-state";
export { CARD_ROW_MIN_H, CARD_ROW_PADDING, LIST_ROW_MIN_H } from "./composites/row-metrics";
export { NotFound } from "./composites/not-found";
export { DetailHeader, PageHeader } from "./composites/page-header";
export {
  ChatCount,
  chatCountLabel,
  ListRow,
  type ListRowProps,
  ListRows,
  ListRowsSkeleton,
  rowParts,
} from "./composites/list-row";
export {
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  ReasonDialog,
  validateReason,
} from "./composites/reason-dialog";
export {
  type KnownStatus,
  STATUS_TONES,
  StatusBadge,
  StatusDot,
  type StatusTone,
  statusLabel,
  statusTone,
} from "./composites/status-badge";
export { StickyActions } from "./composites/sticky-actions";
export {
  dropIndex,
  edgeScrollStep,
  LONG_PRESS_MS,
  moveAnnouncement,
  moveItem,
  pressOutcome,
} from "./reorder/reorder-math";
export { DragHandle, ReorderItem, ReorderList, ReorderMenuItems } from "./reorder/reorder";
export { type Reorder, type ReorderHandleProps, useReorder } from "./reorder/use-reorder";
export {
  addPresetGroup,
  addTypedGroup,
  countsLine,
  duplicateDeliverable,
  groupsFromPresets,
  groupsSummary,
  newDeliverables,
  type StagePresetOption,
  uniqueLabel,
} from "./stage-groups/editing";
export {
  DeliverablesEditor,
  type DeliverablesEditorProps,
} from "./stage-groups/deliverables-editor";
export { DeliverablesPreview } from "./stage-groups/deliverables-preview";
export { StageGroupsEditor, type StageGroupsEditorProps } from "./stage-groups/stage-groups-editor";
export { AppShell } from "./shell/app-shell";
export {
  alertsInBottomNav,
  homeFor,
  isActivePath,
  MOBILE_MORE,
  MOBILE_PRIMARY,
  type MobileNav,
  mobileNavFor,
  NAV_BY_ROLE,
  type NavIconName,
  type NavItem,
  navFor,
  PROFILE_NAV_ITEM,
  SETTINGS_SECTIONS,
  type SettingsSection,
  settingsSectionsFor,
} from "./shell/nav";
export {
  initialsOf,
  isShellRole,
  SHELL_ROLES,
  type ShellRole,
  type ShellViewer,
} from "./shell/viewer";
export { ThemeLabel } from "./theme/theme-label";
export { ThemeProvider } from "./theme/theme-provider";
export { ThemeToggle } from "./theme/theme-toggle";
export { describeError, toastResult } from "./toast";
