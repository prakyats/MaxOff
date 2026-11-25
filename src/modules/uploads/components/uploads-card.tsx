"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ResultError } from "@/core/errors/result";
import { getInBackground } from "@/core/http/background";
import { systemClock } from "@/core/time";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  copyUploadLink,
  getUploadLink,
  markFilesReceived,
  renewUploadLink,
  stopUploadLink,
} from "../actions/links";
import type { UploadCard } from "../domain/card";
import { CARD_POLL_MS, canMakeLink, cardIsMoving, receivedCopy } from "../domain/card-view";
import { CARD, CardHead, UploadsCardBody } from "./uploads-card-body";
import { UploaderSheetView } from "./uploader-sheet";

/** The late reason's bounds, the same as Done's (`modules/tasks` REASON_MAX). */
const LATE_MIN = 3;
const LATE_MAX = 2000;

export type UploadsCardProps = {
  taskId: string;
  taskTitle: string;
  taskState: string;
  /** `null`: the page's read failed; the card offers Retry. */
  initial: UploadCard | null;
  /** The viewer's own name, so "Closed by you". */
  viewerName: string | null;
  /** The Owner (`uploads.network`): the sheet shows the IP and can erase it. */
  network: boolean;
  /** The viewer may mark the task Done ("" for themself, a name for a freelancer), else null. */
  markDoneFor: string | null;
  /** The Owner's own task: Done completes it. */
  completes: boolean;
  primaryName: string;
  dueAt: string;
  /** No other next step on the page: All files received is its one solid button (sticky). */
  solid: boolean;
};

/**
 * The Uploads card on a task's Work view (v4.5, WORKFLOWS §5B.1, §5B.3, §5B.5; sample §1, §5,
 * §6), for the Owner and the task's Admins only. It re-reads itself every few seconds while
 * something uploads and the card is on screen and the page visible, and stops when nothing moves
 * (the written exception to ARCHITECTURE §10a). The link's address is shown only here, only after
 * Get, Copy or Make a new link (the token is never stored, plan A3).
 */
export function UploadsCard(props: UploadsCardProps) {
  const { taskId } = props;
  const [card, setCard] = useState<UploadCard | null>(props.initial);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "get" | "copy">(null);
  const [dialog, setDialog] = useState<null | "stop" | "renew" | "received">(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const reread = useCallback(async (): Promise<boolean> => {
    const read = await getInBackground<UploadCard>("/api/uploads/card", { task: taskId });
    if (read.ok) setCard(read.data);
    return read.ok;
  }, [taskId]);

  const moving = card ? cardIsMoving(card) : false;
  useMovingPoll(root, moving, reread);

  if (!card) {
    return (
      <div ref={root} className="min-w-0">
        <section data-slot="uploads-card" className={CARD}>
          <CardHead title="Uploads" />
          <div className="flex flex-col items-start gap-3 px-4 pb-4">
            <ErrorText slot="uploads-error">The uploads couldn&apos;t be loaded.</ErrorText>
            <Button
              variant="secondary"
              pending={retrying}
              pendingLabel="Retrying…"
              onClick={async () => {
                setRetrying(true);
                await reread();
                setRetrying(false);
              }}
            >
              Retry
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const live = canMakeLink(props.taskState);
  const open = card.state === "active" || card.state === "looks_finished";

  async function getLink() {
    setBusy("get");
    const result = await getUploadLink({ taskId });
    setBusy(null);
    if (toastResult(result, { success: "Upload link ready" })) {
      setUrl(result.ok ? result.data.url : null);
      await reread();
    }
  }

  async function copyLink() {
    if (!card?.link) return;
    setBusy("copy");
    const linkId = card.link.id;
    const asked = copyUploadLink({ linkId });
    const copied = await copyFrom(asked);
    const result = await asked;
    setBusy(null);
    if (!result.ok) {
      toastResult(result);
      return;
    }
    setUrl(result.data.url);
    toastResult(result, {
      success: copied ? "Link copied" : "Copy the link from the card",
    });
  }

  return (
    <div ref={root} className="min-w-0">
      <UploadsCardBody
        card={card}
        taskState={props.taskState}
        now={systemClock()}
        viewerName={props.viewerName}
        url={url}
        busy={busy}
        solid={props.solid}
        markDoneFor={props.markDoneFor}
        on={{
          get: () => void getLink(),
          copy: () => void copyLink(),
          renew: () => setDialog("renew"),
          received: () => setDialog("received"),
          open: (uploaderId) => setSheetFor(uploaderId),
        }}
        menu={
          open && live ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Upload link actions"
                  data-slot="uploads-menu"
                  className="size-11 md:size-8"
                >
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48" title="Upload link">
                <DropdownMenuItem onSelect={() => setDialog("renew")}>
                  Make a new link
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("stop")}>
                  Stop link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      >
        <ConfirmDialog
          open={dialog === "stop"}
          onOpenChange={(next) => setDialog(next ? "stop" : null)}
          title="Stop the upload link?"
          description="Nobody can start sending new files with it. Files already received stay in the folder. A file still on its way may finish."
          confirmLabel="Stop the link"
          destructive
          onConfirm={async () => {
            if (!card.link) return;
            const result = await stopUploadLink({ linkId: card.link.id });
            if (toastResult(result, { success: "Upload link stopped" })) {
              setUrl(null);
              await reread();
            }
          }}
        />
        <ConfirmDialog
          open={dialog === "renew"}
          onOpenChange={(next) => setDialog(next ? "renew" : null)}
          title="Make a new link?"
          description={
            open
              ? "The current link stops working at once. Files already received stay in the folder."
              : "A new link for this task. The old one never works again; its files stay in the folder."
          }
          confirmLabel="Make a new link"
          onConfirm={async () => {
            const result = await renewUploadLink({ taskId });
            if (toastResult(result, { success: "New upload link ready" })) {
              setUrl(result.ok ? result.data.url : null);
              await reread();
            }
          }}
        />
        {open && card.link ? (
          <ReceivedDialog
            open={dialog === "received"}
            onOpenChange={(next) => setDialog(next ? "received" : null)}
            card={card}
            linkId={card.link.id}
            props={props}
            onDone={async () => {
              setUrl(null);
              await reread();
            }}
          />
        ) : null}
        <UploaderSheetView
          uploaderId={sheetFor}
          network={props.network}
          onOpenChange={(next) => (next ? null : setSheetFor(null))}
        />
      </UploadsCardBody>
    </div>
  );
}

function ReceivedDialog({
  open,
  onOpenChange,
  card,
  linkId,
  props,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: UploadCard;
  linkId: string;
  props: UploadsCardProps;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<ResultError | null>(null);
  const markDone = props.markDoneFor !== null;
  const [lateAsked, setLateAsked] = useState(false);
  const late = markDone && (lateAsked || systemClock().getTime() > Date.parse(props.dueAt));
  const copy = receivedCopy({
    card,
    taskTitle: props.taskTitle,
    markDoneFor: props.markDoneFor,
    primaryName: props.primaryName,
    completes: props.completes,
  });
  const summary = formError ? describeError(formError) : null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title="All files received?"
      description={copy.description}
      confirmLabel={copy.confirm}
      cancelLabel="Not yet"
      approve={markDone}
      onConfirm={async () => {
        const text = reason.trim();
        if (late && text.length < LATE_MIN) {
          setError("Say why it's late: a few words are enough.");
          return false;
        }
        const result = await markFilesReceived({
          linkId,
          markDone,
          lateReason: late ? text : null,
        });
        if (!result.ok) {
          if (result.error.fieldErrors?.lateReason || result.error.code === "REASON_REQUIRED") {
            setLateAsked(true);
            setError(
              result.error.fieldErrors?.lateReason?.[0] ??
                "Say why it's late: a few words are enough.",
            );
            return false;
          }
          setFormError(result.error);
          return false;
        }
        toastResult(result, {
          success:
            result.data.path === "marked_done"
              ? "Files received and marked done"
              : "Files received",
        });
        await onDone();
      }}
    >
      <div className="flex flex-col gap-3" data-slot="uploads-received-sheet">
        {summary ? (
          <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
        ) : null}
        <p className="text-sm font-medium">{copy.facts}</p>
        {copy.stillUploading ? (
          <p className="bg-attention-soft rounded-lg px-3 py-2 text-sm">{copy.stillUploading}</p>
        ) : null}
        {late ? (
          <FormField label="Why is it late?" error={error ?? undefined}>
            {(control) => (
              <Textarea
                {...control}
                name="lateReason"
                rows={2}
                maxLength={LATE_MAX}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setError(null);
                }}
              />
            )}
          </FormField>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

/**
 * Writes the link to the clipboard while the tap still counts as the person's (Safari refuses a
 * write after an `await`): a `ClipboardItem` holding the answer's promise where the browser has
 * one, else a plain write once the answer is in. False when the browser refused.
 */
async function copyFrom(
  asked: Promise<{ ok: true; data: { url: string } } | { ok: false }>,
): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const text = asked.then((result) => {
        if (!result.ok) throw new Error("no link");
        return new Blob([result.data.url], { type: "text/plain" });
      });
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
      return true;
    }
    const result = await asked;
    if (!result.ok || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(result.data.url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-reads while `moving`, the card on screen and the page visible (WORKFLOWS §5B.3); a page that
 * comes back into view reads once at once. Nothing runs while nothing moves.
 */
function useMovingPoll(
  root: React.RefObject<HTMLElement | null>,
  moving: boolean,
  reread: () => Promise<boolean>,
) {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setOnScreen(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!moving || !onScreen) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = () => {
      timer = setTimeout(async () => {
        if (stopped) return;
        if (document.visibilityState === "visible") await reread();
        if (!stopped) tick();
      }, CARD_POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void reread();
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [moving, onScreen, reread]);
}
