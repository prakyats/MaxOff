/**
 * Makes a task's folder path in the connected Drive, each folder once (v4.0). Walks
 * `taskFolderPath`, reuses what the cache holds for **this** account, and creates only what is
 * missing, in order, recording each before making the next, so a run that stops half way
 * resumes where it stopped and never makes a folder twice.
 *
 * The owner's folder rules (Q1–Q4, 18 Nov): folders are made on first use (this walk); a task
 * already filed stays in the month it was first made in, so its cached folder is returned
 * before any month is looked at; a client folder whose cached name is not the client's name
 * now is renamed in Drive on the way past (the folder stays the same one).
 */
import { type FolderStep, taskFolderPath, type TaskFolderInput } from "./folders";

export type CachedFolder = { id: string; driveFolderId: string; name: string };

/** The folder cache (`drive_folders`, service role only), as the data layer gives it. */
export type FolderStore = {
  find(step: FolderStep, accountId: string): Promise<CachedFolder | null>;
  put(
    step: FolderStep,
    accountId: string,
    parent: CachedFolder | null,
    driveFolderId: string,
  ): Promise<CachedFolder>;
  /** Records the new name of a cached folder just renamed in Drive. */
  rename(folder: CachedFolder, name: string): Promise<CachedFolder>;
};

export type FolderMaker = (input: {
  name: string;
  parentId: string | null;
}) => Promise<{ id: string }>;

export type FolderRenamer = (input: { folderId: string; name: string }) => Promise<void>;

export async function ensureTaskFolder(input: {
  store: FolderStore;
  make: FolderMaker;
  rename: FolderRenamer;
  accountId: string;
  /** MaxOff's top folder in that Drive (`drive_folders` kind `root`); Clients and Internal sit in it. */
  root: CachedFolder;
  folder: TaskFolderInput;
}): Promise<CachedFolder> {
  const path = taskFolderPath(input.folder);
  const taskStep = path.at(-1);
  // Q2: filed once, a task's folder stays where it is, whatever month it is now.
  const filed = taskStep ? await input.store.find(taskStep, input.accountId) : null;
  if (filed) return filed;

  let parent: CachedFolder = input.root;
  for (const step of path) {
    const cached = await input.store.find(step, input.accountId);
    if (cached) {
      // Q3: a renamed client renames its folder.
      if (step.kind === "client" && cached.name !== step.name) {
        await input.rename({ folderId: cached.driveFolderId, name: step.name });
        parent = await input.store.rename(cached, step.name);
      } else {
        parent = cached;
      }
      continue;
    }
    const made = await input.make({ name: step.name, parentId: parent.driveFolderId });
    // `put` returns the row that won, so a race with another run reuses its folder.
    parent = await input.store.put(step, input.accountId, parent, made.id);
  }
  return parent;
}
