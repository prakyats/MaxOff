/**
 * Which editors on the page hold unsaved changes (task 2.9). A module-level registry, like
 * `delayed-sends.ts`, so code that is not inside the editor can ask: refresh on return does not
 * refetch under someone's typing, and the Log out confirmation warns that changes will be lost.
 */
const dirty = new Set<string>();

/** Registers or clears one editor's unsaved state. */
export function setEditDirty(id: string, isDirty: boolean): void {
  if (isDirty) dirty.add(id);
  else dirty.delete(id);
}

/** True while any editor on the page has changes that are not saved. */
export function anyEditDirty(): boolean {
  return dirty.size > 0;
}
