"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ERROR_MESSAGES } from "@/core/errors/codes";
import type { Result, ResultError } from "@/core/errors/result";
import { isNetworkError, NETWORK_ERROR_CREATE_MESSAGE } from "@/core/ui/action/network-error";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { describeError, toastResult } from "@/core/ui/toast";

import { movedPosition } from "../domain/positions";

export type ListRow = { id: string; name: string; position: string };

/** A name sent and not yet in the server's list: drawn at once, faded (the 7B rework's flake). */
type PendingAdd = { key: number; name: string; before: number };

/** How many rows carry `name` (an item list may hold the same title twice). */
function countNamed(rows: readonly ListRow[], name: string): number {
  return rows.filter((row) => row.name === name).length;
}

/** What a refusal says under the field or in the toast: a field's own message first (zod's). */
function refusalText(error: ResultError): { title: string; description?: string } {
  const field = Object.values(error.fieldErrors ?? {}).flat()[0];
  return field ? { title: describeError(error).title, description: field } : describeError(error);
}

/**
 * A list of names edited in a sheet (7.3; WORKFLOWS §5.4 items 8, 9; amendment D2): a project's
 * default stages, its item list, one item's own stages or one list line's stages. Add, rename,
 * move up or down, remove (a removed stage is archived, its tick kept in the history; a removed
 * line of the item list never touches an existing cycle). Each change is one transition function,
 * applied at once; the server's list comes back after it. Back closes the sheet (§14.2 a); the
 * removal's confirmation closes first. A name typed and not yet added or renamed is not lost
 * silently: back asks "Discard what you typed?", and back on that keeps editing (§14.2 f). A
 * stage list is `unique`: a name the list already has (ignoring case) is refused before it is
 * sent, as the database refuses it (the 7B rework's review, S3). **An add shows at once:** the
 * name joins the list, faded and inert, the moment it is sent, and gives way to the server's row
 * when the refreshed list carries it (a refused add, or one that never got an answer, takes it
 * back and returns the name to the field with the reason under it). The server's list follows the action's whole re-render, which on a busy server or a
 * slow phone took seconds (and longer when a live refresh of the same screen ran first).
 */
export function ListEditorSheet({
  open,
  onOpenChange,
  title,
  description,
  noun,
  removeDescription,
  rows,
  rowAction,
  unique = false,
  max,
  maxLength,
  onAdd,
  addedMessage,
  onRename,
  onMove,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** "stage" / "item": "Remove the stage Edit?". */
  noun: string;
  /** What a removal does, in the confirmation ("It leaves this item; …"). */
  removeDescription: string;
  rows: readonly ListRow[];
  /** One more control per row, after Remove (the item list's "Stages" for a line, amendment D2). */
  rowAction?: ((row: ListRow) => React.ReactNode) | undefined;
  /** Each name once, ignoring case (a stage list). */
  unique?: boolean;
  max: number;
  maxLength: number;
  onAdd: (name: string) => Promise<Result<unknown>>;
  /** The toast once an add is saved ("Reel 4 added from November 2026"); none without it. */
  addedMessage?: ((name: string) => string) | undefined;
  onRename: (id: string, name: string) => Promise<Result<unknown>>;
  onMove: (id: string, position: string) => Promise<Result<unknown>>;
  onRemove: (id: string) => Promise<Result<unknown>>;
}) {
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ListRow | null>(null);
  const [pending, setPending] = useState<readonly PendingAdd[]>([]);
  const nextKey = useRef(0);
  // Sent names the server's list does not carry yet; one it carries gives way to its row.
  const shown = pending.filter((add) => countNamed(rows, add.name) <= add.before);
  if (shown.length !== pending.length) setPending(shown);
  const [asking, setAsking] = useState(false);
  // Set while the sheet hands over to "Discard?": the rename a closing field's blur would send
  // waits for the answer instead.
  const holding = useRef(false);
  const dirty =
    adding.trim() !== "" ||
    rows.some((row) => names[row.id] !== undefined && names[row.id]?.trim() !== row.name);

  /** The refusal for a name another row has, when the list is `unique`. */
  function taken(name: string, except: string | null): string | null {
    if (!unique) return null;
    const key = name.trim().toLowerCase();
    const other =
      rows.find((row) => row.id !== except && row.name.trim().toLowerCase() === key)?.name ??
      pending.find((add) => add.name.toLowerCase() === key)?.name;
    return other ? `This list already has a ${noun} called ${other}.` : null;
  }

  function requestClose(next: boolean) {
    if (!next && dirty && busy === null) {
      holding.current = true;
      setAsking(true);
      return;
    }
    onOpenChange(next);
  }

  function keepEditing() {
    holding.current = false;
    setAsking(false);
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clash = taken(adding, null);
    if (clash) {
      setAddError(clash);
      return;
    }
    const name = adding.trim();
    const add: PendingAdd = { key: nextKey.current++, name, before: countNamed(rows, name) };
    setBusy("add");
    setPending((current) => [...current, add]);
    setAdding("");
    setAddError(null);
    // A refused or failed add takes its faded row back and returns the name to the field.
    const takeBack = (message: string) => {
      setPending((current) => current.filter((other) => other.key !== add.key));
      setAdding((typed) => (typed === "" ? name : typed));
      setAddError(message);
    };
    try {
      const result = await onAdd(name);
      if (!result.ok) {
        const { title: heading, description: detail } = refusalText(result.error);
        takeBack(detail ?? heading);
        return;
      }
      if (addedMessage) toast.success(addedMessage(name));
    } catch (error) {
      // No answer (the phone lost its connection): the add may or may not have landed, and the
      // refreshed list shows it if it did. Anything else is a failure on the server's side.
      takeBack(isNetworkError(error) ? NETWORK_ERROR_CREATE_MESSAGE : ERROR_MESSAGES.INTERNAL);
    } finally {
      setBusy(null);
    }
  }

  async function rename(row: ListRow) {
    if (holding.current) return;
    const name = names[row.id];
    if (name === undefined || name.trim() === row.name) return;
    const clash = taken(name, row.id);
    if (clash) {
      toast.error("That name is taken", { description: clash });
      return;
    }
    setBusy(row.id);
    const result = await onRename(row.id, name);
    if (result.ok) {
      toast.success("Renamed");
    } else {
      const { title: heading, description: detail } = refusalText(result.error);
      toast.error(heading, detail ? { description: detail } : undefined);
    }
    setNames((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    setBusy(null);
  }

  async function move(index: number, direction: "up" | "down") {
    const row = rows[index];
    const position = movedPosition(rows, index, direction);
    if (!row || position === null) return;
    setBusy(row.id);
    toastResult(await onMove(row.id, position));
    setBusy(null);
  }

  return (
    <>
      <ReviewSheet
        open={open && !asking}
        onOpenChange={requestClose}
        title={title}
        description={description}
      >
        <div className="flex flex-col gap-3" data-slot="list-editor">
          {rows.length + shown.length === 0 ? (
            <p className="text-muted-foreground">None yet.</p>
          ) : (
            <ol className="border-border divide-border divide-y rounded-lg border">
              {rows.map((row, index) => (
                <li
                  key={row.id}
                  data-slot="list-editor-row"
                  className="flex items-center gap-1 p-1"
                >
                  <Input
                    aria-label={`Name of ${row.name}`}
                    value={names[row.id] ?? row.name}
                    maxLength={maxLength}
                    disabled={busy === row.id}
                    onChange={(event) =>
                      setNames((current) => ({ ...current, [row.id]: event.target.value }))
                    }
                    onBlur={() => void rename(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void rename(row);
                      }
                    }}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${row.name} up`}
                    disabled={index === 0 || busy !== null}
                    onClick={() => void move(index, "up")}
                  >
                    <ArrowUpIcon aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${row.name} down`}
                    disabled={index === rows.length - 1 || busy !== null}
                    onClick={() => void move(index, "down")}
                  >
                    <ArrowDownIcon aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${row.name}`}
                    disabled={busy !== null}
                    onClick={() => setRemoving(row)}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                  {rowAction ? rowAction(row) : null}
                </li>
              ))}
              {shown.map((add) => (
                <li
                  key={`pending-${add.key}`}
                  data-slot="list-editor-row"
                  data-pending=""
                  className="flex items-center gap-1 p-1 opacity-60"
                >
                  <Input
                    aria-label={`Name of ${add.name}`}
                    value={add.name}
                    disabled
                    readOnly
                    className="min-w-0 flex-1"
                  />
                </li>
              ))}
            </ol>
          )}
          {rows.length + shown.length < max ? (
            <form onSubmit={add} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`New ${noun}`}
                  placeholder={`Add a ${noun}`}
                  value={adding}
                  maxLength={maxLength}
                  onChange={(event) => setAdding(event.target.value)}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  pending={busy === "add"}
                  pendingLabel="Adding…"
                  disabled={!adding.trim()}
                >
                  <PlusIcon aria-hidden />
                  Add
                </Button>
              </div>
              {addError ? <ErrorText>{addError}</ErrorText> : null}
            </form>
          ) : (
            <p className="text-muted-foreground text-xs">At most {max}.</p>
          )}
        </div>
      </ReviewSheet>
      <ConfirmDialog
        open={asking}
        onOpenChange={(next) => (next ? null : keepEditing())}
        title="Discard what you typed?"
        description={`The ${noun}s stay as they are.`}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setAdding("");
          setAddError(null);
          setNames({});
          onOpenChange(false);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? null : setRemoving(null))}
        title={removing ? `Remove the ${noun} ${removing.name}?` : ""}
        description={removeDescription}
        confirmLabel={`Remove ${noun}`}
        onConfirm={async () => {
          if (!removing) return;
          const done = toastResult(await onRemove(removing.id), { success: "Removed" });
          if (done) setRemoving(null);
          return done;
        }}
      />
    </>
  );
}
