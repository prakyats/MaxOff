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
export { DataTable, type DataTableProps, selectionColumn } from "./composites/data-table";
export { EmptyState } from "./composites/empty-state";
export { ErrorState } from "./composites/error-state";
export { Forbidden } from "./composites/forbidden";
export { LoadingState, PageLoading } from "./composites/loading-state";
export { NotFound } from "./composites/not-found";
export { PageHeader } from "./composites/page-header";
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
  type StatusTone,
  statusLabel,
  statusTone,
} from "./composites/status-badge";
export { AppShell } from "./shell/app-shell";
export {
  homeFor,
  isActivePath,
  NAV_BY_ROLE,
  type NavIconName,
  type NavItem,
  type NavPermission,
  navFor,
  SETTINGS_SECTIONS,
  type SettingsSection,
  settingsSectionsFor,
} from "./shell/nav";
export {
  initialsOf,
  isShellRole,
  ROLE_LABELS,
  SHELL_ROLES,
  type ShellRole,
  type ShellViewer,
} from "./shell/viewer";
export { ThemeProvider } from "./theme/theme-provider";
export { ThemeToggle } from "./theme/theme-toggle";
export { describeError, toastResult } from "./toast";
