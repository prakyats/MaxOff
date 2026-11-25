import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import {
  formatSize,
  type HandinFile,
  type HandinRead,
  type HandinVersion,
  isRiskyName,
  sameFileKey,
  statusOf,
  typeLabel,
  versionSummary,
} from "@/modules/handin";
import { HandinDriveCheck, HandinLeaveOut } from "@/modules/handin/components/handin-card";
import { HandinAdderLazy } from "@/modules/handin/components/handin-lazy";

/**
 * v5.0 "Hand in work" on the task's Work view (the approved sample §1, §5–§7; WORKFLOWS §5C), a
 * **server component**, so the card's markup costs no first-load JavaScript (`/tasks/[id]`'s
 * budget is never raised): the version the next Mark done hands in, with its files as they reach
 * the studio Drive, and the versions already handed in. The Owner and the task's Admins get Open
 * in Drive (Q6); everyone else on the task sees names and sizes. Nothing from the files themselves
 * is loaded into MaxOff. Its client parts: Leave out, the Drive check and the add area (lazy).
 */

/** How many files a version shows before "Show all N" (expands in place; no history step). */
const FIRST_FILES = 5;

const FILE_URL = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
const FOLDER_URL = (id: string) =>
  `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

export type HandinViewProps = {
  taskId: string;
  read: HandinRead;
  /** Each handed-in version's time, formatted on the server ("26 Nov, 4:12 pm"). */
  handedInAt: Record<number, string>;
  /** Member id → display name, as the task page has them. */
  names: Record<string, string>;
  viewerId: string;
  /** The viewer marks Done (the primary owner, or a freelancer primary's coordinator). */
  viewerMarksDone: boolean;
  /** The freelancer the viewer acts for, when they coordinate the primary owner. */
  onBehalfOf: string | null;
  primaryName: string;
  /** The reason of the latest send-back, shown above the open version (sample §7). */
  changeReason: { by: string; reason: string } | null;
};

function nameOf(names: Record<string, string>, id: string | null): string {
  return id ? (names[id] ?? "Someone") : "Someone";
}

function shown(files: HandinFile[]): { visible: HandinFile[]; leftOut: HandinFile[] } {
  return {
    visible: files.filter((file) => file.state !== "left_out"),
    leftOut: files.filter((file) => file.state === "left_out"),
  };
}

function counted(files: HandinFile[]): { count: number; bytes: number } {
  const inDrive = files.filter(
    (file) => file.state === "done" || file.state === "missing_in_drive",
  );
  return { count: inDrive.length, bytes: inDrive.reduce((sum, file) => sum + file.size, 0) };
}

export function HandinView(props: HandinViewProps) {
  const { read } = props;
  const checks =
    read.reviewer && read.versions.some((version) => version.handedIn && version.files.length > 0);
  const open = read.versions.find((version) => !version.handedIn) ?? null;
  const handedIn = read.versions.filter((version) => version.handedIn);
  const mayAddNow = read.taskOpen && read.canAdd;
  const driveOff = mayAddNow && read.drive !== "connected";
  if (!open && handedIn.length === 0 && !mayAddNow) return null;

  const latest = handedIn[0] ?? null;
  const older = handedIn.slice(1);
  const showOpen = read.taskOpen && (open !== null || mayAddNow);

  return (
    <section
      aria-labelledby="task-handin-files-title"
      data-slot="handin-card"
      className="border-border bg-card flex min-w-0 flex-col rounded-lg border"
    >
      {checks ? <HandinDriveCheck taskId={props.taskId} /> : null}
      <header className="border-border flex min-h-11 flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 id="task-handin-files-title" className="text-sm font-semibold">
          Files
        </h2>
        {showOpen ? (
          <StatusBadge
            status="handin_open"
            tone="neutral"
            label={`v${read.openVersion} · not handed in yet`}
          />
        ) : latest ? (
          <StatusBadge status="handin_done" tone="success" label={`v${latest.version} handed in`} />
        ) : null}
      </header>

      {showOpen ? (
        <div className="flex min-w-0 flex-col gap-3 p-3" data-slot="handin-open">
          {props.changeReason ? (
            <div
              className="bg-attention-soft flex flex-col gap-1 rounded-md px-3 py-2 text-sm"
              data-slot="handin-change-reason"
            >
              <span className="text-attention font-medium">
                Changes requested by {props.changeReason.by}
              </span>
              <span className="break-words">{props.changeReason.reason}</span>
            </div>
          ) : null}
          {driveOff ? (
            <p
              className="bg-neutral-soft rounded-md px-3 py-2 text-sm"
              data-slot="handin-drive-off"
            >
              Handing in files is off until the Owner reconnects Google Drive. You can still mark
              the task done with a note.
            </p>
          ) : null}
          {open ? (
            <VersionFiles {...props} version={open} openVersion summary={null} emptyText={null} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Add the photos and videos for this task. They go straight into the studio&apos;s Drive
              and stay full quality.
            </p>
          )}
          {mayAddNow && !driveOff ? (
            <HandinAdderLazy
              taskId={props.taskId}
              onBehalfOf={props.onBehalfOf}
              alreadyInDrive={(open?.files ?? [])
                .filter((file) => file.state === "done")
                .map((file) => sameFileKey(file))}
            />
          ) : null}
          {mayAddNow && !props.viewerMarksDone ? (
            <p className="text-muted-foreground text-xs" data-slot="handin-who-hands-in">
              {props.primaryName} marks it done and hands it in.
            </p>
          ) : null}
        </div>
      ) : null}

      {latest ? (
        <div
          className={cn("flex min-w-0 flex-col gap-2 p-3", showOpen && "border-border border-t")}
          data-slot="handin-latest"
        >
          <VersionHead
            version={latest}
            names={props.names}
            reviewer={read.reviewer}
            at={props.handedInAt[latest.version] ?? null}
          />
          <VersionFiles
            {...props}
            version={latest}
            openVersion={false}
            summary={null}
            emptyText="Handed in with a note only."
          />
        </div>
      ) : null}

      {older.map((version) => (
        <details
          key={version.version}
          className="group border-border min-w-0 border-t"
          data-slot="handin-older"
        >
          <summary className="focus-visible:ring-ring flex min-h-[52px] cursor-pointer items-center gap-2 px-3 text-sm outline-none focus-visible:ring-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">
                v{version.version} · {versionSummary(...countPair(version.files))}
              </span>
              <span className="text-muted-foreground text-xs">
                Handed in {props.handedInAt[version.version] ?? ""}
              </span>
            </span>
            <ChevronRightIcon
              aria-hidden
              className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
          </summary>
          <div className="flex min-w-0 flex-col gap-2 px-3 pb-3">
            <VersionHead
              version={version}
              names={props.names}
              reviewer={read.reviewer}
              at={props.handedInAt[version.version] ?? null}
            />
            <VersionFiles
              {...props}
              version={version}
              openVersion={false}
              summary={null}
              emptyText="Handed in with a note only."
            />
          </div>
        </details>
      ))}
    </section>
  );
}

function countPair(files: HandinFile[]): [number, number] {
  const { count, bytes } = counted(files);
  return [count, bytes];
}

function VersionHead({
  version,
  names,
  reviewer,
  at,
}: {
  version: HandinVersion;
  names: Record<string, string>;
  reviewer: boolean;
  at: string | null;
}) {
  const who = version.onBehalfOf
    ? `${nameOf(names, version.submittedBy)} for ${nameOf(names, version.onBehalfOf)}`
    : nameOf(names, version.submittedBy);
  const [count, bytes] = countPair(version.files);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-muted-foreground min-w-0 flex-1 text-xs break-words">
        v{version.version} · {who}
        {at ? ` · ${at}` : ""} · {versionSummary(count, bytes)}
      </span>
      {reviewer && version.folderId ? (
        <a
          href={FOLDER_URL(version.folderId)}
          target="_blank"
          rel="noreferrer"
          className="pressable inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4"
          data-slot="handin-folder-link"
        >
          Open the v{version.version} folder in Drive
          <ExternalLinkIcon aria-hidden className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}

function VersionFiles({
  version,
  openVersion,
  emptyText,
  names,
  viewerMarksDone,
  onBehalfOf,
  read,
}: HandinViewProps & {
  version: HandinVersion;
  openVersion: boolean;
  summary: null;
  emptyText: string | null;
}) {
  const { visible, leftOut } = shown(version.files);
  if (visible.length === 0 && leftOut.length === 0) {
    return emptyText ? <p className="text-muted-foreground text-sm">{emptyText}</p> : null;
  }
  const row = (file: HandinFile, left = false) => (
    <FileRow
      key={file.id}
      file={file}
      addedBy={
        left
          ? file.leftOutBy
            ? `left out by ${nameOf(names, file.leftOutBy)}`
            : "left out"
          : file.mine
            ? null
            : nameOf(names, file.onBehalfOf ?? file.addedBy)
      }
      reviewer={read.reviewer}
      canLeaveOut={!left && openVersion && read.taskOpen && (file.mine || viewerMarksDone)}
      onBehalfOf={file.mine ? null : onBehalfOf}
    />
  );
  const more = visible.slice(FIRST_FILES);
  // "Show all" opens in place (native details: no history step, no script).
  const label = [
    more.length > 0 ? `Show all ${visible.length}` : null,
    leftOut.length > 0 ? `${leftOut.length} left out` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex min-w-0 flex-col">
      <ul className="flex min-w-0 flex-col" aria-label={`Files in v${version.version}`}>
        {visible.slice(0, FIRST_FILES).map((file) => row(file))}
      </ul>
      {label ? (
        <details className="group min-w-0">
          <summary
            className="text-muted-foreground focus-visible:ring-ring flex min-h-11 cursor-pointer items-center justify-center rounded-md text-sm outline-none focus-visible:ring-2"
            data-slot="handin-show-all"
          >
            {label}
          </summary>
          {more.length > 0 ? (
            <ul className="flex min-w-0 flex-col" aria-label={`More files in v${version.version}`}>
              {more.map((file) => row(file))}
            </ul>
          ) : null}
          {leftOut.length > 0 ? (
            <ul className="flex min-w-0 flex-col opacity-80" aria-label="Left out">
              {leftOut.map((file) => row(file, true))}
            </ul>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function FileRow({
  file,
  addedBy,
  reviewer,
  canLeaveOut,
  onBehalfOf,
}: {
  file: HandinFile;
  addedBy: string | null;
  reviewer: boolean;
  canLeaveOut: boolean;
  onBehalfOf: string | null;
}) {
  const status = statusOf(file.state);
  const where = [file.relativePath, formatSize(file.size), addedBy].filter(Boolean).join(" · ");
  const leaveable = canLeaveOut && file.state !== "left_out" && file.state !== "missing_in_drive";
  return (
    <li
      className="border-border flex min-h-[60px] min-w-0 items-center gap-3 border-t py-2 first:border-t-0"
      data-slot="handin-file"
      data-state={file.state}
    >
      <span
        aria-hidden
        className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md text-xs font-semibold"
      >
        {typeLabel(file.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{file.name}</span>
        <span className="text-muted-foreground truncate text-xs">{where}</span>
      </span>
      {isRiskyName(file.name) ? (
        <StatusBadge status="risky" tone="neutral" label="Check before opening" />
      ) : null}
      {file.state === "done" && reviewer && file.driveFileId ? (
        <a
          href={FILE_URL(file.driveFileId)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${file.name} in Drive`}
          className="pressable inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 text-sm underline underline-offset-4"
          data-slot="handin-open-file"
        >
          <span className="hidden sm:inline">Open in Drive</span>
          <ExternalLinkIcon aria-hidden className="size-4" />
        </a>
      ) : file.state === "done" && file.afterHandin ? (
        <StatusBadge status="after" tone="neutral" label="Arrived after hand-in" />
      ) : (
        <StatusBadge status={file.state} tone={status.tone} label={status.label} />
      )}
      {leaveable ? (
        <HandinLeaveOut fileId={file.id} name={file.name} onBehalfOf={onBehalfOf} />
      ) : null}
    </li>
  );
}
