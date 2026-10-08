"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";

import type { Result } from "@/core/errors/result";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { describeError, toastResult } from "@/core/ui/toast";

import { movedPosition } from "../domain/positions";

export type ListRow = { id: string; name: string; position: string };

/**
 * A project's stages or item list, edited in a sheet (7.3; WORKFLOWS §5.4 items 8, 9): add, rename,
 * move up or down, remove (a removed stage is archived, its ticks kept in the history; a removed
 * line of the item list never touches an existing cycle). Each change is one transition function,
 * applied at once; the server's list comes back after it. Back closes the sheet (§14.2 a); the
 * removal's confirmation closes first. A name typed and not yet added or renamed is not lost
 * silently: back asks "Discard what you typed?", and back on that keeps editing (§14.2 f).
 */
export function ListEditorSheet({
  open,
  onOpenChange,
  title,
  description,
  noun,
  rows,
  max,
  maxLength,
  onAdd,
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
  rows: readonly ListRow[];
  max: number;
  maxLength: number;
  onAdd: (name: string) => Promise<Result<unknown>>;
  onRename: (id: string, name: string) => Promise<Result<unknown>>;
  onMove: (id: string, position: string) => Promise<Result<unknown>>;
  onRemove: (id: string) => Promise<Result<unknown>>;
}) {
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ListRow | null>(null);
  const [asking, setAsking] = useState(false);
  // Set while the sheet hands over to "Discard?": the rename a closing field's blur would send
  // waits for the answer instead.
  const holding = useRef(false);
  const dirty =
    adding.trim() !== "" ||
    rows.some((row) => names[row.id] !== undefined && names[row.id]?.trim() !== row.name);

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
    setBusy("add");
    const result = await onAdd(adding);
    setBusy(null);
    if (!result.ok) {
      const { title: heading, description: detail } = describeError(result.error);
      setAddError(detail ?? heading);
      return;
    }
    setAdding("");
    setAddError(null);
  }

  async function rename(row: ListRow) {
    if (holding.current) return;
    const name = names[row.id];
    if (name === undefined || name.trim() === row.name) return;
    setBusy(row.id);
    toastResult(await onRename(row.id, name), { success: "Renamed" });
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
          {rows.length === 0 ? (
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
                </li>
              ))}
            </ol>
          )}
          {rows.length < max ? (
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
        description={
          noun === "stage"
            ? "It leaves every item; its ticks stay in the history."
            : "Later cycles start without it. The current cycle keeps its items."
        }
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
