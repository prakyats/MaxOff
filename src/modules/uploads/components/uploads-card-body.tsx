import { ChevronRightIcon, CopyIcon, ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { Button } from "@/core/ui/primitives/button";
import { ProgressBar } from "@/core/ui/progress/segmented-meter";

import type { UploadCard, UploadCardUploader } from "../domain/card";
import {
  activityWords,
  bytesOf,
  canMakeLink,
  cardChip,
  cardSummary,
  driveFolderUrl,
  sizeOf,
  stoppedLine,
  uploaderChips,
  uploaderFilesLine,
} from "../domain/card-view";

/** What the card's controls do, once its code has arrived (`uploads-card.tsx`). */
export type CardHandlers = {
  get: () => void;
  copy: () => void;
  renew: () => void;
  received: () => void;
  open: (uploaderId: string) => void;
};

/**
 * The Uploads card's markup (v4.5, WORKFLOWS §5B.3; the sample §1, §5): no hooks, so the task page
 * draws it on the server as the card's first paint and `UploadsCard` draws the same once its code
 * has arrived after the page (ARCHITECTURE §19, `AfterPage`): the first load keeps its budget and
 * nothing moves when the card turns live. Without `on` its buttons are inert stand-ins.
 */
export function UploadsCardBody({
  card,
  taskState,
  now,
  viewerName,
  url = null,
  busy = null,
  solid,
  markDoneFor,
  menu,
  on,
  children,
}: {
  card: UploadCard;
  taskState: string;
  now: Date;
  viewerName: string | null;
  url?: string | null;
  busy?: "get" | "copy" | null;
  solid: boolean;
  markDoneFor: string | null;
  /** The live ⋯ menu; a stand-in until then. */
  menu?: ReactNode;
  on?: CardHandlers;
  /** The live card's dialogs and sheet. */
  children?: ReactNode;
}) {
  const live = canMakeLink(taskState);
  const open = card.state === "active" || card.state === "looks_finished";
  const chip = cardChip(card);
  const summary = open ? cardSummary(card) : null;
  const usable = open && card.link?.sealed === true;
  return (
    <section
      data-slot="uploads-card"
      data-state={card.state}
      data-live={on ? "" : undefined}
      className={CARD}
    >
      <CardHead
        title="Uploads"
        chip={
          chip ? (
            <StatusBadge status={`uploads-${card.state}`} label={chip.label} tone={chip.tone} />
          ) : null
        }
        summary={summary}
        menu={menu ?? (open && live ? <MenuStandIn /> : null)}
      />

      {card.state === "none" ? (
        <div className="flex flex-col items-start gap-3 px-4 pb-4">
          <p className="text-muted-foreground text-sm">
            Make a private link so a freelancer or camera operator can send files straight into this
            task&apos;s Drive folder, with no login.
          </p>
          <Button
            variant="secondary"
            pending={busy === "get"}
            pendingLabel="Making the link…"
            onClick={on?.get}
          >
            Get upload link
          </Button>
        </div>
      ) : null}

      {open && !card.link?.sealed ? (
        <div className="flex flex-col items-start gap-3 px-4 pb-4">
          <p className="text-sm" data-slot="uploads-unsealed">
            This link was made with an older key and no longer works. Make a new link.
          </p>
          {live ? (
            <Button variant="secondary" onClick={on?.renew}>
              Make a new link
            </Button>
          ) : null}
        </div>
      ) : null}

      {usable ? (
        <div className="flex flex-col gap-2 px-4 pb-3" data-slot="uploads-link">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {url ? (
              <input
                readOnly
                aria-label="Upload link"
                data-slot="uploads-link-url"
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="border-border bg-muted/40 text-muted-foreground min-h-11 min-w-0 flex-1 rounded-md border px-3 text-base md:min-h-9 md:text-sm"
              />
            ) : null}
            <Button
              variant="secondary"
              pending={busy === "copy"}
              pendingLabel="Copying…"
              onClick={on?.copy}
              data-slot="uploads-copy"
            >
              <CopyIcon aria-hidden />
              Copy link
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Works until the task is done or cancelled, or until you stop it. Anyone who has it can
            send files.
          </p>
        </div>
      ) : null}

      {open ? <Bands card={card} /> : null}

      {card.state === "stopped" ? (
        <div className="flex flex-col gap-1 px-4 pb-3" data-slot="uploads-closed">
          <p className="text-sm font-medium">
            {card.files} {card.files === 1 ? "file" : "files"} · {sizeOf(card.bytes)} from{" "}
            {card.people} {card.people === 1 ? "person" : "people"}
          </p>
          <p className="text-muted-foreground text-sm">{stoppedLine(card, viewerName)}</p>
        </div>
      ) : null}

      {card.uploaders.length > 0 ? (
        <ul className="border-border border-t" data-slot="uploads-uploaders">
          {card.uploaders.map((uploader) => (
            <UploaderRow
              key={uploader.id}
              uploader={uploader}
              now={now}
              onOpen={on ? () => on.open(uploader.id) : undefined}
            />
          ))}
        </ul>
      ) : open && usable ? (
        <p
          className="text-muted-foreground border-border border-t px-4 py-3 text-sm"
          data-slot="uploads-empty"
        >
          Nothing yet. Send the link to whoever has the files. You&apos;ll see each person here as
          soon as they start.
        </p>
      ) : null}

      {card.state !== "none" ? (
        <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3">
          {card.taskFolderId ? (
            <a
              href={driveFolderUrl(card.taskFolderId)}
              target="_blank"
              rel="noopener noreferrer"
              className="pressable inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-4 md:min-h-0"
              data-slot="uploads-folder"
            >
              Open the folder in Drive
              <ExternalLinkIcon aria-hidden className="size-3.5" />
            </a>
          ) : null}
          <span className="text-muted-foreground text-xs">
            Files go straight to the studio Drive.
          </span>
          {card.state === "stopped" && live ? (
            <Button variant="secondary" className="md:ml-auto" onClick={on?.renew}>
              Make a new link
            </Button>
          ) : null}
        </div>
      ) : null}

      {open && card.link ? (
        <ReceivedAction solid={solid} markDoneFor={markDoneFor} onOpen={on?.received} />
      ) : null}
      {children}
    </section>
  );
}

/** The ⋯ before the menu's code has arrived: the same button, inert. */
function MenuStandIn() {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Upload link actions"
      data-slot="uploads-menu"
      className="size-11 md:size-8"
    >
      <MoreHorizontalIcon aria-hidden />
    </Button>
  );
}

export const CARD =
  "bg-card flex min-w-0 flex-col ring-foreground/10 shadow-raised rounded-xl ring-1";

export function CardHead({
  title,
  chip,
  summary,
  menu,
}: {
  title: string;
  chip?: React.ReactNode;
  summary?: string | null;
  menu?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3 pb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {chip}
      {summary ? (
        <span className="text-muted-foreground text-sm" data-slot="uploads-summary">
          {summary}
        </span>
      ) : null}
      {menu ? <span className="ml-auto">{menu}</span> : null}
    </div>
  );
}

/** What holds new files back, said once on the card (WORKFLOWS §5B.6). */
function Bands({ card }: { card: UploadCard }) {
  const bands: string[] = [];
  if (card.driveState === "needs_reconnect") {
    bands.push(
      "The studio's Drive needs reconnecting: uploads wait until the Owner reconnects it.",
    );
  }
  if (card.link?.pausedUntil) {
    bands.push(
      "Google's daily upload limit is reached: new files wait, and start again by themselves.",
    );
  }
  if (card.state === "looks_finished") {
    bands.push(
      "Nothing has moved for 10 min and every started file is in. Check the folder, then tap All files received.",
    );
  }
  if (bands.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      {bands.map((band) => (
        <p
          key={band}
          data-slot="uploads-band"
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            card.state === "looks_finished" && band.startsWith("Nothing")
              ? "bg-attention-soft"
              : "bg-neutral-soft",
          )}
        >
          {band}
        </p>
      ))}
    </div>
  );
}

function UploaderRow({
  uploader,
  now,
  onOpen,
}: {
  uploader: UploadCardUploader;
  now: Date;
  onOpen: (() => void) | undefined;
}) {
  const chips = uploaderChips(uploader, now);
  const received = uploader.bytesDone;
  return (
    <li className="border-border border-t first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        data-slot="uploads-uploader"
        data-uploader={uploader.name}
        className="pressable-row flex min-h-11 w-full min-w-0 items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold">{uploader.name}</span>
            {chips.map((chip) => (
              <StatusBadge key={chip.label} status="uploader" label={chip.label} tone={chip.tone} />
            ))}
          </span>
          <span className="text-muted-foreground text-sm">{uploaderFilesLine(uploader)}</span>
          <ProgressBar
            counts={{ done: received, next: 0, total: Math.max(uploader.bytesTotal, 1) }}
            label={null}
            className="max-w-xs"
          />
          <span className="text-muted-foreground text-xs">
            {bytesOf(received, uploader.bytesTotal)} · {activityWords(uploader.lastActivityAt, now)}
          </span>
        </span>
        <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      </button>
    </li>
  );
}

/**
 * "All files received": the page's one solid button when nothing else is (sticky at a phone's
 * foot), else an outline in the card, so a layer never holds two solid commits (ADR-0015).
 */
function ReceivedAction({
  solid,
  markDoneFor,
  onOpen,
}: {
  solid: boolean;
  markDoneFor: string | null;
  onOpen: (() => void) | undefined;
}) {
  const button = (
    <Button
      // Forest only when the sheet's own commit is an approve (Mark done); else neutral (ADR-0015).
      variant={solid ? (markDoneFor !== null ? "approve" : "strong") : "secondary"}
      opens
      onClick={onOpen}
      data-slot="uploads-received"
    >
      All files received
    </Button>
  );
  return (
    <div className="border-border flex flex-col gap-2 border-t px-4 py-3">
      <p className="text-muted-foreground text-sm">
        Look through the list and the Drive folder.{" "}
        {markDoneFor !== null
          ? "All files received stops the link and marks the task Done."
          : "All files received stops the link and tells the task's primary owner."}
      </p>
      {solid ? (
        <StickyActions className="md:justify-start">{button}</StickyActions>
      ) : (
        <div>{button}</div>
      )}
    </div>
  );
}
