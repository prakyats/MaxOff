/**
 * Where a task's files go in the studio Drive (v4.0; ADR-0010): `Clients / ‹client› / ‹YYYY-MM›
 * / ‹task›`, or `Internal / ‹YYYY-MM› / ‹task›` for a task with no client (PRODUCT §4.10).
 * MaxOff names every folder; nobody types a path. Each step is cached by what it stands for
 * (the client's and the task's ids, the month), never by its name, so a renamed client keeps
 * its one folder.
 */
export type FolderKind = "root" | "clients" | "internal" | "client" | "month" | "task";

export type FolderStep = {
  kind: FolderKind;
  name: string;
  clientId: string | null;
  month: string | null;
  taskId: string | null;
};

export type TaskFolderInput = {
  client: { id: string; name: string } | null;
  /** `YYYY-MM`, in IST: the month the folder is made in (an answer pending, #89 Q2). */
  month: string;
  task: { id: string; title: string };
};

/** MaxOff's own top folder in the connected Drive, made on connect. */
export const ROOT_FOLDER = "MaxOff";
export const CLIENTS_FOLDER = "Clients";
export const INTERNAL_FOLDER = "Internal";
/** Drive allows long names; a folder name this long is unreadable in Drive's own lists. */
export const FOLDER_NAME_MAX = 120;

export function folderName(text: string): string {
  // One line, no slashes (they read as paths in Drive's breadcrumbs), no runs of spaces.
  const clean = text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const name =
    clean.length > FOLDER_NAME_MAX ? `${clean.slice(0, FOLDER_NAME_MAX - 1).trimEnd()}…` : clean;
  return name === "" ? "Untitled" : name;
}

export function isMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function taskFolderPath(input: TaskFolderInput): FolderStep[] {
  if (!isMonth(input.month)) throw new Error(`Not a month: ${input.month}`);
  const clientId = input.client?.id ?? null;
  const top: FolderStep[] = input.client
    ? [
        { kind: "clients", name: CLIENTS_FOLDER, clientId: null, month: null, taskId: null },
        {
          kind: "client",
          name: folderName(input.client.name),
          clientId,
          month: null,
          taskId: null,
        },
      ]
    : [{ kind: "internal", name: INTERNAL_FOLDER, clientId: null, month: null, taskId: null }];
  return [
    ...top,
    { kind: "month", name: input.month, clientId, month: input.month, taskId: null },
    // Keyed by the task alone: filed once, it stays in the month it was first made in (Q2).
    {
      kind: "task",
      name: folderName(input.task.title),
      clientId: null,
      month: null,
      taskId: input.task.id,
    },
  ];
}
