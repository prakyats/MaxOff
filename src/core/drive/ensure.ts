/**
 * Makes a task's folder path in the connected Drive, each folder once (v4.0). Walks
 * `taskFolderPath`, reuses what the cache holds for **this** account, and creates only what is
 * missing, in order, recording each before making the next, so a run that stops half way
 * resumes where it stopped and never makes a folder twice.
 */
import { type FolderStep, taskFolderPath, type TaskFolderInput } from "./folders";

export type CachedFolder = { id: string; driveFolderId: string };

/** The folder cache (`drive_folders`, service role only), as the data layer gives it. */
export type FolderStore = {
  find(step: FolderStep, accountId: string): Promise<CachedFolder | null>;
  put(
    step: FolderStep,
    accountId: string,
    parent: CachedFolder | null,
    driveFolderId: string,
  ): Promise<CachedFolder>;
};

export type FolderMaker = (input: {
  name: string;
  parentId: string | null;
}) => Promise<{ id: string }>;

export async function ensureTaskFolder(input: {
  store: FolderStore;
  make: FolderMaker;
  accountId: string;
  /** MaxOff's top folder in that Drive (`drive_folders` kind `root`); Clients and Internal sit in it. */
  root: CachedFolder;
  folder: TaskFolderInput;
}): Promise<CachedFolder> {
  let parent: CachedFolder = input.root;
  for (const step of taskFolderPath(input.folder)) {
    const cached = await input.store.find(step, input.accountId);
    if (cached) {
      parent = cached;
      continue;
    }
    const made = await input.make({ name: step.name, parentId: parent.driveFolderId });
    // `put` returns the row that won, so a race with another run reuses its folder.
    parent = await input.store.put(step, input.accountId, parent, made.id);
  }
  return parent;
}
