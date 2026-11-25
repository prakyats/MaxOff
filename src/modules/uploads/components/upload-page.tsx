"use client";

import { CheckIcon, MinusIcon, UploadIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { sizeWords } from "@/core/lib/size-words";
import { cn } from "@/core/lib/utils";
import { createUploadEngine, type ItemState, type UploadEngine } from "@/core/upload";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";

import type {
  DoneAnswer,
  ProgressAnswer,
  RegisterAnswer,
  ResolveAnswer,
  SaidDoneAnswer,
  StartAnswer,
} from "../domain/api";
import { NAME_MAX } from "../domain/names";
import { callUpload, deviceKey, readToken } from "./upload-client";
import {
  BANNER_WORDS,
  bannerOf,
  byFolder,
  engineOpening,
  folderOf,
  overallLine,
  overallOf,
  overallTitle,
  type PageFile,
  rowOf,
  rowOrder,
  speedOf,
  tagOf,
  welcomeWords,
} from "./upload-page-model";

/** Files sent at once (WORKFLOWS §5B.2: "two or three"); the server allows six per uploader. */
const AT_ONCE = 3;
/** Rows shown before "+ N more" (the sample's lists). */
const FIRST_ROWS = 4;

type Phase =
  | { kind: "loading" }
  | { kind: "bad" }
  | { kind: "busy"; seconds: number }
  | { kind: "name" }
  | { kind: "main" }
  | { kind: "thanks" };

/**
 * The uploader's page (v4.5, WORKFLOWS §5B.2; the approved sample §2–§4, screens A–R): no MaxOff
 * menus, the studio's name and the task's title only. A phone sends files; a laptop also sends
 * whole folders and takes a drop anywhere on the page. Bytes go from this browser to Google
 * through `core/upload`; MaxOff's API only opens sessions and records what happened.
 */
export function UploadPage({ contact }: { contact: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [info, setInfo] = useState<ResolveAnswer | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [files, setFiles] = useState<PageFile[]>([]);
  const [stopped, setStopped] = useState(false);
  const [carryingOn, setCarryingOn] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  const token = useRef<string | null>(null);
  const key = useRef<string | null>(null);
  const engine = useRef<UploadEngine | null>(null);
  const blobs = useRef(new Map<string, File>());
  /** Engine key → page key, and page key → the engine key of its current attempt. */
  const engineToPage = useRef(new Map<string, string>());
  const attempts = useRef(new Map<string, number>());
  const fileIds = useRef(new Map<string, string>());
  const samples = useRef<{ at: number; sent: number }[]>([]);

  const patch = useCallback((pageKey: string, change: (file: PageFile) => PageFile) => {
    setFiles((list) => list.map((file) => (file.key === pageKey ? change(file) : file)));
  }, []);

  // ---- the link: resolve on arrival -------------------------------------------------------
  const resolve = useCallback(async (fresh = false) => {
    const found = readToken() ?? token.current;
    if (!found) return setPhase({ kind: "bad" });
    token.current = found;
    key.current = await deviceKey(found, fresh);
    const answer = await callUpload<ResolveAnswer>("resolve", found, { deviceKey: key.current });
    if (!answer.ok) {
      if (answer.error.code === "RATE_LIMITED") return setPhase({ kind: "busy", seconds: 60 });
      return setPhase({
        kind: answer.error.code === "NOT_FOUND" ? "bad" : "busy",
        seconds: 30,
      } as Phase);
    }
    setInfo(answer.data);
    if (answer.data.uploader) {
      setName(answer.data.uploader.name);
      setPhase({ kind: "main" });
    } else {
      setName(null);
      setPhase({ kind: "name" });
    }
  }, []);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  // ---- the engine ---------------------------------------------------------------------------
  const addToEngine = useCallback((pageKeys: readonly string[]) => {
    const run = engine.current;
    if (!run) return;
    const items = [];
    for (const pageKey of pageKeys) {
      const blob = blobs.current.get(pageKey);
      if (!blob) continue;
      const attempt = (attempts.current.get(pageKey) ?? 0) + 1;
      attempts.current.set(pageKey, attempt);
      const engineKey = `${pageKey}#${attempt}`;
      engineToPage.current.set(engineKey, pageKey);
      items.push({ key: engineKey, file: blob, relativePath: relativeOf(blob) });
    }
    run.add(items);
  }, []);

  const waitThenRetry = useCallback(
    (pageKey: string, reason: NonNullable<PageFile["waiting"]>, seconds: number) => {
      patch(pageKey, (file) => ({ ...file, waiting: reason }));
      window.setTimeout(() => addToEngine([pageKey]), seconds * 1000);
    },
    [addToEngine, patch],
  );

  const startEngine = useCallback(() => {
    if (engine.current) return engine.current;
    const pageOf = (engineKey: string) => engineToPage.current.get(engineKey) ?? engineKey;
    const pageOfFile = (fileId: string) => {
      for (const [pageKey, id] of fileIds.current) if (id === fileId) return pageKey;
      return null;
    };
    engine.current = createUploadEngine({
      concurrency: AT_ONCE,
      onChange: (engineKey, state: ItemState) => {
        const pageKey = pageOf(engineKey);
        // An older attempt's news is not this file's any more.
        if (`${pageKey}#${attempts.current.get(pageKey) ?? 0}` !== engineKey) return;
        patch(pageKey, (file) => ({ ...file, engine: state }));
      },
      openSession: async (item) => {
        const pageKey = pageOf(item.key);
        const tok = token.current;
        const dev = key.current;
        if (!tok || !dev) throw new Error("no link");
        const answer = await callUpload<StartAnswer>("start", tok, {
          deviceKey: dev,
          name: item.file.name,
          relativePath: item.relativePath,
          sizeBytes: item.file.size,
          mimeType: item.file.type || null,
        });
        if (!answer.ok) {
          if (answer.error.code === "NOT_FOUND") {
            setStopped(true);
            return { refused: "stopped" };
          }
          if (answer.error.code === "RATE_LIMITED") {
            waitThenRetry(pageKey, "too_many", 60);
            return { refused: "limit" };
          }
          throw new Error(answer.error.code);
        }
        const opened = engineOpening(answer.data);
        if ("session" in opened) {
          fileIds.current.set(pageKey, opened.session.fileId);
          patch(pageKey, (file) => ({ ...file, waiting: null, verdict: null }));
          return opened.session;
        }
        if (opened.wait) waitThenRetry(pageKey, opened.wait.reason, opened.wait.seconds);
        return { refused: opened.refused };
      },
      report: async (event) => {
        const tok = token.current;
        const dev = key.current;
        if (!tok || !dev) return;
        if (event.kind === "progress") {
          await callUpload<ProgressAnswer>("progress", tok, {
            deviceKey: dev,
            fileId: event.fileId,
            sent: event.sent,
          });
          return;
        }
        if (event.kind === "failed") {
          await callUpload("failed", tok, {
            deviceKey: dev,
            fileId: event.fileId,
            reason: event.reason.startsWith("unreadable") ? "unreadable" : "gave_up",
          });
          return;
        }
        const answer = await callUpload<DoneAnswer>("done", tok, {
          deviceKey: dev,
          fileId: event.fileId,
          driveFileId: event.driveFileId,
          localMd5: event.localMd5,
        });
        // No answer the page can read: the engine asks again (with backoff).
        if (!answer.ok) throw new Error(answer.error.code);
        const pageKey = pageOfFile(event.fileId);
        if (!pageKey) return;
        const verdict: DoneAnswer =
          answer.data.state === "incomplete"
            ? { state: "failed", reason: "size_mismatch" }
            : answer.data;
        patch(pageKey, (file) => ({ ...file, verdict }));
      },
    });
    return engine.current;
  }, [patch, waitThenRetry]);

  useEffect(() => () => engine.current?.dispose(), []);

  // ---- choosing and sending ------------------------------------------------------------------
  const choose = useCallback((chosen: readonly File[]) => {
    const fresh: PageFile[] = [];
    for (const blob of chosen) {
      const pageKey = crypto.randomUUID();
      blobs.current.set(pageKey, blob);
      fresh.push({
        key: pageKey,
        name: blob.name,
        relativePath: relativeOf(blob),
        size: blob.size,
        queued: true,
        engine: null,
        verdict: null,
        waiting: null,
        notSent: false,
      });
    }
    if (fresh.length > 0) setFiles((list) => [...list, ...fresh]);
  }, []);

  const upload = useCallback(() => {
    startEngine();
    const queued = files.filter((file) => file.queued).map((file) => file.key);
    setFiles((list) => list.map((file) => (file.queued ? { ...file, queued: false } : file)));
    addToEngine(queued);
  }, [addToEngine, files, startEngine]);

  const retry = useCallback(
    (file: PageFile) => {
      const pageKey = file.key;
      const current = `${pageKey}#${attempts.current.get(pageKey) ?? 0}`;
      if (file.verdict === null && file.engine?.state === "failed" && file.engine.canRetry) {
        engine.current?.retry(current);
        return;
      }
      patch(pageKey, (one) => ({ ...one, verdict: null, engine: null }));
      addToEngine([pageKey]);
    },
    [addToEngine, patch],
  );

  // ---- the page's surroundings: offline, screen lock, leaving --------------------------------
  const overall = useMemo(() => overallOf(files), [files]);
  const moving = overall.moving && !stopped;

  const offline = useSyncExternalStore(subscribeOnline, isOffline, () => false);

  useEffect(() => {
    if (!moving) return;
    // K: the browser's own "Leave site?" while files are going.
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", ask);
    // The screen kept awake where the phone allows it; asked again when the page comes back.
    let lock: { release(): Promise<void> } | null = null;
    const wake = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
        };
        lock = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    };
    let hidden = false;
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        hidden = true;
        return;
      }
      void wake();
      if (hidden) {
        hidden = false;
        // F: "Carrying on", hidden again after a few seconds.
        setCarryingOn(true);
        window.setTimeout(() => setCarryingOn(false), 6000);
      }
    };
    void wake();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("beforeunload", ask);
      document.removeEventListener("visibilitychange", visibility);
      void lock?.release().catch(() => undefined);
    };
  }, [moving]);

  // The speed for "about 6 min left": the last 30 seconds of bytes sent, sampled every 2 s.
  const [speed, setSpeed] = useState<number | null>(null);
  const sentNow = useRef(0);
  useEffect(() => {
    sentNow.current = overall.sent;
  }, [overall.sent]);
  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      samples.current = [
        ...samples.current.filter((sample) => now - sample.at < 30_000),
        { at: now, sent: sentNow.current },
      ];
      setSpeed(speedOf(samples.current));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [moving]);

  // ---- "I'm done" ------------------------------------------------------------------------------
  const [saying, setSaying] = useState(false);
  async function saidDone() {
    const tok = token.current;
    const dev = key.current;
    if (!tok || !dev) return;
    setSaying(true);
    const answer = await callUpload<SaidDoneAnswer>("said-done", tok, { deviceKey: dev });
    setSaying(false);
    if (answer.ok) setPhase({ kind: "thanks" });
  }

  function sendMore() {
    setFiles((list) => list.filter((file) => !rowOf(file).finished || file.queued));
    setPhase({ kind: "main" });
  }

  // ---- screens -----------------------------------------------------------------------------
  if (phase.kind === "loading") return <Shell studio={null} name={null} />;
  if (phase.kind === "bad") {
    return (
      <Shell studio="MaxOff" name={null}>
        <Centre mark="stop" title="This upload link doesn't work any more" slot="upload-bad">
          The job may be finished, or the studio stopped the link. Ask the person who sent it to you
          for a new one.
        </Centre>
      </Shell>
    );
  }
  if (phase.kind === "busy") {
    return (
      <Shell studio="MaxOff" name={null}>
        <Centre mark="stop" title="Slow down a moment" slot="upload-busy">
          Too many tries from this network in a short time. Reload this page in about a minute.
        </Centre>
      </Shell>
    );
  }
  if (!info) return <Shell studio={null} name={null} />;

  if (phase.kind === "name") {
    return (
      <Shell studio={info.studioName} name={null}>
        <NameStep
          title={info.taskTitle}
          contact={contact}
          onPrivacy={() => setPrivacy(true)}
          onRegister={async (typed) => {
            const tok = token.current;
            const dev = key.current;
            if (!tok || !dev) return "The link is gone. Open it again.";
            const answer = await callUpload<RegisterAnswer>("register", tok, {
              deviceKey: dev,
              name: typed,
            });
            if (!answer.ok) {
              if (answer.error.code === "NOT_FOUND") {
                setPhase({ kind: "bad" });
                return null;
              }
              return answer.error.message;
            }
            if ("refused" in answer.data) {
              return "This link has had too many new names today. Ask the person who sent it to you.";
            }
            setName(typed.trim());
            setPhase({ kind: "main" });
            return null;
          }}
        />
        <Privacy open={privacy} onOpenChange={setPrivacy} contact={contact} />
      </Shell>
    );
  }

  const shownName = name ?? "";
  if (phase.kind === "thanks") {
    return (
      <Shell studio={info.studioName} name={shownName}>
        <Centre mark="tick" title={`Thanks, ${shownName}`} slot="upload-thanks">
          The studio has been told you&apos;ve finished: {overall.done}{" "}
          {overall.done === 1 ? "file" : "files"}, {sizeWords(overall.bytes)}.
        </Centre>
        <p className="text-muted-foreground text-center text-sm">
          Forgot something? You can still send it with this link.
        </p>
        <Dock>
          <Button variant="secondary" className="w-full" onClick={sendMore}>
            Send more files
          </Button>
        </Dock>
      </Shell>
    );
  }

  const queued = files.filter((file) => file.queued);
  const started = files.filter((file) => !file.queued);
  const received = started.length > 0 && overall.allFinished && overall.failed === 0 && !stopped;
  const banner = bannerOf(started, stopped) ?? startBanner(info, started.length > 0);
  const returning = info.uploader && files.length === 0 ? welcomeWords(info.uploader.files) : null;
  const sorted = [...started].sort((a, b) => rowOrder(a) - rowOrder(b));

  return (
    <Shell
      studio={info.studioName}
      name={shownName}
      onDrop={stopped ? undefined : choose}
      onChangeName={
        moving
          ? undefined
          : () => {
              setFiles([]);
              void resolve(true);
            }
      }
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-sm">Send files for</span>
        <h1 className="text-xl font-semibold tracking-tight break-words" data-slot="upload-task">
          {info.taskTitle}
        </h1>
      </div>

      {moving ? (
        <Band tone="attention" slot="upload-keep-open">
          <b>Keep this page open until it says Done.</b> Closing it or locking your screen pauses
          the upload; it carries on when you come back.
        </Band>
      ) : null}
      {carryingOn ? (
        <Band tone="info" slot="upload-carrying-on">
          <b>Carrying on.</b> The upload paused while your screen was off. Keep the screen on until
          it says Done.
        </Band>
      ) : null}
      {banner ? (
        <Band
          tone={banner === "stopped" ? "neutral" : "attention"}
          slot="upload-banner"
          data-banner={banner}
        >
          <b>{BANNER_WORDS[banner].title}</b>{" "}
          {banner === "stopped"
            ? `${overall.done} ${overall.done === 1 ? "file was" : "files were"} received. `
            : ""}
          {BANNER_WORDS[banner].text}
        </Band>
      ) : null}

      {returning ? (
        <section className="flex flex-col gap-3" data-slot="upload-welcome">
          <h2 className="text-lg font-semibold">Welcome back, {shownName}</h2>
          <p className="text-sm">{returning.line}</p>
          {returning.unfinished.length > 0 ? (
            <ul className="border-border rounded-lg border">
              {returning.unfinished.slice(0, FIRST_ROWS).map((file) => (
                <FileRow
                  key={`${file.relativePath}/${file.name}`}
                  name={file.name}
                  path={file.relativePath}
                  line="Not finished · choose it again"
                  label="Not sent"
                  tone="neutral"
                />
              ))}
              {returning.unfinished.length > FIRST_ROWS ? (
                <li className="text-muted-foreground border-border border-t px-3 py-2 text-sm">
                  + {returning.unfinished.length - FIRST_ROWS} more not sent
                </li>
              ) : null}
            </ul>
          ) : null}
        </section>
      ) : null}

      {received ? (
        <Centre
          mark="tick"
          title={`All ${overall.total} ${overall.total === 1 ? "file" : "files"} received`}
          slot="upload-received"
        >
          {sizeWords(overall.bytes)} sent to the studio for {info.taskTitle}. You can close this
          page.
        </Centre>
      ) : null}

      {started.length > 0 ? (
        <section className="flex flex-col gap-2" data-slot="upload-overall">
          {!received ? (
            <div className="flex flex-col gap-1">
              <span className="text-lg font-semibold tabular-nums" data-slot="upload-overall-title">
                {overallTitle(overall)}
              </span>
              <span
                className="text-muted-foreground text-sm tabular-nums"
                data-slot="upload-overall-line"
              >
                {overallLine(overall, { offline, bytesPerSecond: speed })}
              </span>
              <Meter done={overall.sent} total={overall.bytes} />
            </div>
          ) : null}
          <FileList
            files={sorted}
            showAll={showAll}
            onShowAll={() => setShowAll(true)}
            onRetry={stopped ? undefined : retry}
          />
        </section>
      ) : null}

      {queued.length > 0 ? (
        <section className="flex flex-col gap-2" data-slot="upload-ready">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-semibold tabular-nums">
              {queued.length} {queued.length === 1 ? "file" : "files"} ·{" "}
              {sizeWords(queued.reduce((n, f) => n + f.size, 0))}
            </span>
          </div>
          <ul className="border-border rounded-lg border">
            {queued.map((file) => (
              <FileRow
                key={file.key}
                name={file.name}
                path={file.relativePath}
                line={sizeWords(file.size)}
                remove={() => {
                  blobs.current.delete(file.key);
                  setFiles((list) => list.filter((one) => one.key !== file.key));
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {!stopped && !received ? <Chooser empty={files.length === 0} onChoose={choose} /> : null}

      {offline && started.length > 0 ? (
        <Band tone="neutral" slot="upload-offline">
          <b>No connection.</b> Your files carry on from where they stopped when you&apos;re back
          online.
        </Band>
      ) : null}

      <Dock>
        {queued.length > 0 && !stopped ? (
          // pending: none (hands the files to the engine at once; each row shows its own progress)
          <Button
            variant="primary"
            className="w-full md:w-auto"
            onClick={upload}
            data-slot="upload-send"
          >
            Upload {queued.length} {queued.length === 1 ? "file" : "files"}
          </Button>
        ) : received ? (
          <>
            <p className="text-muted-foreground text-sm">
              Finished for this job? Tell the studio, so they don&apos;t wait for more. It&apos;s
              optional.
            </p>
            <div className="flex flex-col gap-2 md:flex-row">
              <Button
                variant="primary"
                pending={saying}
                pendingLabel="Telling the studio…"
                onClick={saidDone}
                data-slot="upload-said-done"
              >
                I&apos;m done
              </Button>
              <Button variant="secondary" onClick={sendMore}>
                Send more files
              </Button>
            </div>
          </>
        ) : overall.failed > 0 && !moving && !stopped ? (
          // pending: none (starts each file again at once; each row shows its own progress)
          <Button
            variant="primary"
            className="w-full md:w-auto"
            onClick={() => started.filter((file) => rowOf(file).retry).forEach(retry)}
          >
            Retry {overall.failed} {overall.failed === 1 ? "file" : "files"}
          </Button>
        ) : null}
      </Dock>
    </Shell>
  );
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const isOffline = () => !navigator.onLine;

/** The folder path the browser gives a file chosen in a folder or dropped with one. */
function relativeOf(file: File): string {
  const path = file as File & { webkitRelativePath?: string; maxoffPath?: string };
  return folderOf(path.maxoffPath ?? path.webkitRelativePath ?? "");
}

/** What `resolve` said before any file starts: the Drive is out (R), or Google paused (O). */
function startBanner(
  info: ResolveAnswer,
  started: boolean,
): "drive_unavailable" | "daily_limit" | null {
  if (started) return null;
  if (info.canStart === "drive_unavailable") return "drive_unavailable";
  if (info.canStart === "paused") return "daily_limit";
  return null;
}

// ---- pieces ------------------------------------------------------------------------------------

function Shell({
  studio,
  name,
  children,
  onDrop,
  onChangeName,
}: {
  studio: string | null;
  name: string | null;
  children?: React.ReactNode;
  onDrop?: ((files: File[]) => void) | undefined;
  onChangeName?: (() => void) | undefined;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className="bg-background text-foreground flex min-h-dvh flex-col"
      data-slot="upload-page"
      data-drop={over ? "over" : undefined}
      onDragOver={
        onDrop
          ? (event) => {
              event.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={onDrop ? () => setOver(false) : undefined}
      onDrop={
        onDrop
          ? (event) => {
              event.preventDefault();
              setOver(false);
              void droppedFiles(event.dataTransfer).then(onDrop);
            }
          : undefined
      }
    >
      <header className="border-border bg-background flex h-13 items-center gap-2.5 border-b px-4 pt-[env(safe-area-inset-top)] md:px-6">
        <span
          aria-hidden
          className="bg-logo text-logo-foreground grid size-7 place-items-center rounded-md text-sm font-semibold"
        >
          {(studio ?? "M").slice(0, 1).toUpperCase()}
        </span>
        <span className="flex-1 truncate font-semibold" data-slot="upload-studio">
          {studio ?? <span className="bg-muted inline-block h-4 w-28 animate-pulse rounded" />}
        </span>
        {name ? (
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            <span className="hidden md:inline">Sending as</span>
            <span className="text-foreground font-medium" data-slot="upload-name">
              {name}
            </span>
            {onChangeName ? (
              <button
                type="button"
                aria-label={`Not ${name}? Use another name`}
                className="pressable min-h-11 underline underline-offset-4 md:min-h-0"
                onClick={onChangeName}
              >
                <span className="md:hidden">Not {name}?</span>
                <span className="hidden md:inline">change</span>
              </button>
            ) : null}
          </span>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:py-6">
        {children ?? <PageSkeleton />}
      </main>
    </div>
  );
}

/** While the link is being checked: screen A's shape, so nothing jumps when it arrives. */
function PageSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4" data-slot="upload-loading">
      <span className="bg-muted h-4 w-24 animate-pulse rounded" />
      <span className="bg-muted h-7 w-48 animate-pulse rounded" />
      <span className="bg-muted mt-2 h-11 w-full animate-pulse rounded-md" />
    </div>
  );
}

function Dock({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      className="border-border bg-card sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mx-0 md:border-0 md:bg-transparent md:px-0"
      data-slot="upload-dock"
    >
      {children}
    </div>
  );
}

function Band({
  tone,
  slot,
  children,
  ...rest
}: {
  tone: "attention" | "info" | "neutral" | "danger";
  slot: string;
  children: React.ReactNode;
  "data-banner"?: string;
}) {
  return (
    <p
      role="status"
      data-slot={slot}
      {...rest}
      className={cn(
        "rounded-lg px-3 py-2.5 text-sm [&_b]:font-semibold",
        tone === "attention" && "bg-attention-soft [&_b]:text-attention",
        tone === "info" && "bg-info-soft [&_b]:text-info",
        tone === "neutral" && "bg-neutral-soft",
        tone === "danger" && "bg-danger-soft [&_b]:text-danger",
      )}
    >
      {children}
    </p>
  );
}

function Centre({
  mark,
  title,
  slot,
  children,
}: {
  mark: "tick" | "stop";
  title: string;
  slot: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-2.5 px-2 py-7 text-center" data-slot={slot}>
      <span
        aria-hidden
        className={cn(
          "grid size-14 place-items-center rounded-full",
          mark === "tick" ? "bg-success-soft text-success" : "bg-neutral-soft text-neutral",
        )}
      >
        {mark === "tick" ? <CheckIcon className="size-7" /> : <MinusIcon className="size-7" />}
      </span>
      <h1 className="text-lg font-semibold text-balance">{title}</h1>
      <p className="text-muted-foreground max-w-sm text-sm">{children}</p>
    </section>
  );
}

function Meter({ done, total }: { done: number; total: number }) {
  const share = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <span aria-hidden className="bg-neutral-soft flex h-2 overflow-hidden rounded-full">
      <span
        className="bg-success h-full transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${share}%` }}
      />
    </span>
  );
}

const TONES = {
  neutral: "bg-neutral-soft text-neutral",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
} as const;

function FileRow({
  name,
  path,
  line,
  label,
  tone,
  remove,
  retry,
  slot = "upload-file",
  state,
}: {
  name: string;
  path: string;
  line: string;
  label?: string;
  tone?: keyof typeof TONES;
  remove?: (() => void) | undefined;
  retry?: (() => void) | undefined;
  slot?: string;
  state?: string;
}) {
  return (
    <li
      className="border-border flex min-h-15 min-w-0 items-center gap-3 border-t px-3 py-2.5 first:border-t-0"
      data-slot={slot}
      data-state={state}
    >
      <span
        aria-hidden
        className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold"
      >
        {tagOf(name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium" data-slot="upload-file-name">
          {name}
        </span>
        {path ? <span className="text-faint truncate text-xs">{path}</span> : null}
        <span className="text-muted-foreground text-xs tabular-nums">{line}</span>
      </span>
      {retry ? (
        <Button variant="secondary" size="sm" onClick={retry}>
          Retry
        </Button>
      ) : null}
      {label && tone ? (
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone])}>
          {label}
        </span>
      ) : null}
      {remove ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Take ${name} out`}
          className="size-11 shrink-0"
          onClick={remove}
        >
          <XIcon aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

function FileList({
  files,
  showAll,
  onShowAll,
  onRetry,
}: {
  files: PageFile[];
  showAll: boolean;
  onShowAll: () => void;
  onRetry?: ((file: PageFile) => void) | undefined;
}) {
  const groups = byFolder(files);
  const folders = groups.length > 1 || (groups[0] !== undefined && groups[0][0] !== "");
  const shown = showAll ? files.length : FIRST_ROWS;
  const visible = shownGroups(groups, shown);
  return (
    <div className="flex flex-col gap-3" data-slot="upload-files">
      {visible.map(({ folder, list, rows }) => {
        const done = list.filter((file) => rowOf(file).label === "Done").length;
        return (
          <div key={folder || "-"} className="flex flex-col gap-1">
            {folders ? (
              <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {folder || "Files"} · {done} of {list.length}
              </span>
            ) : null}
            <ul className="border-border rounded-lg border">
              {rows.map((file) => {
                const row = rowOf(file);
                return (
                  <FileRow
                    key={file.key}
                    name={file.name}
                    path=""
                    line={row.line}
                    label={row.label}
                    tone={row.tone}
                    state={row.label}
                    retry={row.retry && onRetry ? () => onRetry(file) : undefined}
                  />
                );
              })}
            </ul>
          </div>
        );
      })}
      {files.length > shown ? (
        <button
          type="button"
          className="pressable min-h-11 text-left text-sm underline underline-offset-4"
          onClick={onShowAll}
        >
          + {files.length - shown} more
        </button>
      ) : null}
    </div>
  );
}

/** The first `limit` rows across the folders, each folder keeping its own total. */
function shownGroups(
  groups: [string, PageFile[]][],
  limit: number,
): { folder: string; list: PageFile[]; rows: PageFile[] }[] {
  const out: { folder: string; list: PageFile[]; rows: PageFile[] }[] = [];
  let left = limit;
  for (const [folder, list] of groups) {
    if (left <= 0) break;
    const rows = list.slice(0, left);
    left -= rows.length;
    out.push({ folder, list, rows });
  }
  return out;
}

function Chooser({ empty, onChoose }: { empty: boolean; onChoose: (files: File[]) => void }) {
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement | null) => {
    if (!input?.files) return;
    onChoose([...input.files]);
    input.value = "";
  };
  return (
    <section
      className={cn(
        "border-control-border flex flex-col items-center gap-2.5 rounded-lg border-[1.5px] border-dashed px-4 py-5 text-center",
        !empty && "py-3",
      )}
      data-slot="upload-choose"
    >
      {empty ? (
        <>
          <span aria-hidden className="bg-muted grid size-11 place-items-center rounded-full">
            <UploadIcon className="size-5" />
          </span>
          <b className="font-semibold">
            <span className="md:hidden">Choose the files to send</span>
            <span className="hidden md:inline">Drop files or folders here</span>
          </b>
          <span className="text-muted-foreground text-sm">
            <span className="md:hidden">
              Photos and videos from your phone, any size. Big videos take a while: keep this page
              open.
            </span>
            <span className="hidden md:inline">
              Any type, any size. Folders keep their structure.
            </span>
          </span>
        </>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="secondary"
          onClick={() => filesInput.current?.click()}
          data-slot="upload-choose-files"
        >
          {empty ? "Choose files" : "Add more files"}
        </Button>
        <Button
          variant="secondary"
          className="hidden md:inline-flex"
          onClick={() => folderInput.current?.click()}
        >
          Choose a folder
        </Button>
      </div>
      <input
        ref={filesInput}
        type="file"
        multiple
        hidden
        aria-label="Choose files"
        onChange={(event) => take(event.currentTarget)}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        aria-label="Choose a folder"
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(event) => take(event.currentTarget)}
      />
      {empty ? (
        <p className="text-muted-foreground text-xs md:hidden">
          Sending a whole folder? Open this link on a laptop to keep the folders as they are.
        </p>
      ) : null}
    </section>
  );
}

function NameStep({
  title,
  contact,
  onPrivacy,
  onRegister,
}: {
  title: string;
  contact: string | null;
  onPrivacy: () => void;
  onRegister: (name: string) => Promise<string | null>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      noValidate
      className="flex flex-1 flex-col gap-4"
      data-slot="upload-name-step"
      onSubmit={async (event) => {
        event.preventDefault();
        if (value.trim() === "") {
          setError("Type your name to continue");
          return;
        }
        setPending(true);
        const refused = await onRegister(value);
        setPending(false);
        setError(refused);
      }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-sm">Send files for</span>
        <h1 className="text-xl font-semibold tracking-tight break-words" data-slot="upload-task">
          {title}
        </h1>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="upload-name" className="text-sm font-semibold">
          Your name
        </label>
        <input
          id="upload-name"
          name="name"
          autoComplete="name"
          maxLength={NAME_MAX}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby="upload-name-hint"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          className="border-control-border bg-card focus-visible:ring-ring aria-invalid:border-danger h-11 rounded-md border px-3 text-base outline-none focus-visible:ring-2"
        />
        <span
          id="upload-name-hint"
          className={cn("text-xs", error ? "text-danger" : "text-muted-foreground")}
          role={error ? "alert" : undefined}
        >
          {error ?? "The studio sees this name next to your files."}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        Your name, the files you send, and your IP address and device are kept so the studio knows
        who sent what. IP and device are erased after 90 days.
        {contact ? (
          <>
            {" "}
            Questions: <span className="text-foreground break-all">{contact}</span>.
          </>
        ) : null}{" "}
        <button
          type="button"
          className="pressable min-h-11 underline underline-offset-4 md:min-h-0"
          onClick={onPrivacy}
        >
          How we use this
        </button>
      </p>
      <Dock>
        <Button
          type="submit"
          variant="primary"
          className="w-full md:w-auto"
          pending={pending}
          pendingLabel="Continuing…"
          data-slot="upload-continue"
        >
          Continue
        </Button>
      </Dock>
    </form>
  );
}

function Privacy({
  open,
  onOpenChange,
  contact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="upload-privacy">
        <DialogHeader>
          <DialogTitle>How we use this</DialogTitle>
          <DialogDescription>
            What the studio keeps when you send files with this link.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            Your files go straight from this device to the studio&apos;s Google Drive. Nobody else
            gets a copy.
          </li>
          <li>The studio sees the name you typed next to your files. It isn&apos;t checked.</li>
          <li>
            Your IP address and the kind of device you used are kept for 90 days so the studio can
            tell who sent what, then erased. The name and the list of files stay with the job.
          </li>
          <li>
            This page never shows you anyone else&apos;s files, and coming back on this device shows
            only your own.
          </li>
          {contact ? <li>Questions, corrections or erasure: {contact}.</li> : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Files from a drop, folders walked (their path kept as `maxoffPath`), the laptop's §4. */
async function droppedFiles(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items]
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry?.() : null))
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (entries.length === 0) return [...data.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, folder: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      ).catch(() => null);
      if (file) {
        Object.defineProperty(file, "maxoffPath", {
          value: folder ? `${folder}/${file.name}` : file.name,
        });
        out.push(file);
      }
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) =>
          reader.readEntries(resolve, () => resolve([])),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, path);
      }
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}
